import { ExamType } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../prisma.js";
import {
  ensureAssessorReviewStub,
  runAutoAssessmentForSubmission,
} from "../lib/runAutoAssessment.js";
import { recordAuditLog } from "../lib/auditLog.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";

export const assessorRouter = Router();

assessorRouter.get("/practical-submissions", async (_req, res) => {
  const assignments = await prisma.examAssignment.findMany({
    where: {
      exam: { type: ExamType.PRACTICAL },
      status: "SUBMITTED",
    },
    include: {
      student: true,
      exam: true,
      workspace: {
        include: {
          submissions: {
            where: { isFinal: true },
            orderBy: { submittedAt: "desc" },
            take: 1,
            include: { autoAssessment: true },
          },
        },
      },
      assessorReview: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const rows = assignments.map((a) => {
    const sub = a.workspace?.submissions[0];
    const auto = sub?.autoAssessment;
    return {
      assignmentId: a.id,
      studentName: `${a.student.firstName} ${a.student.lastName}`,
      examTitle: a.exam.title,
      submittedAt: sub?.submittedAt.toISOString() ?? null,
      submissionId: sub?.id ?? null,
      automatedScorePercent: auto?.scorePercent ?? null,
      finalScorePercent: a.assessorReview?.finalScorePercent ?? null,
      hasFeedback: Boolean(a.assessorReview?.feedback?.trim()),
    };
  });
  res.json(rows);
});

assessorRouter.get("/assignments/:assignmentId", async (req, res) => {
  const assignment = await prisma.examAssignment.findUnique({
    where: { id: req.params.assignmentId },
    include: {
      student: true,
      exam: { include: { practicalTests: { orderBy: { sortOrder: "asc" } } } },
      assessorReview: true,
      workspace: {
        include: {
          submissions: {
            where: { isFinal: true },
            orderBy: { submittedAt: "desc" },
            take: 1,
            include: { autoAssessment: true },
          },
        },
      },
    },
  });
  if (!assignment || assignment.exam.type !== ExamType.PRACTICAL) {
    res.status(404).json({ error: "Practical assignment not found" });
    return;
  }

  const submission = assignment.workspace?.submissions[0];
  const files = submission
    ? (JSON.parse(submission.filesSnapshot) as { filename: string; content: string }[])
    : [];
  const auto = submission?.autoAssessment;
  const report = auto ? JSON.parse(auto.reportJson) : null;

  const logs = await prisma.practicalAssessorReviewLog.findMany({
    where: { assignmentId: assignment.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  res.json({
    assignment: {
      id: assignment.id,
      status: assignment.status,
      student: assignment.student,
      exam: assignment.exam,
    },
    submission: submission
      ? {
          id: submission.id,
          submittedAt: submission.submittedAt.toISOString(),
          files,
        }
      : null,
    automated: auto
      ? {
          scorePercent: auto.scorePercent,
          earnedPoints: auto.earnedPoints,
          maxPoints: auto.maxPoints,
          ranAt: auto.ranAt.toISOString(),
          report,
        }
      : null,
    review: assignment.assessorReview
      ? {
          automatedScorePercent: assignment.assessorReview.automatedScorePercent,
          finalScorePercent: assignment.assessorReview.finalScorePercent,
          feedback: assignment.assessorReview.feedback,
          updatedAt: assignment.assessorReview.updatedAt.toISOString(),
        }
      : null,
    reviewLog: logs.map((l) => ({
      id: l.id,
      automatedScorePercent: l.automatedScorePercent,
      finalScorePercent: l.finalScorePercent,
      feedback: l.feedback,
      createdAt: l.createdAt.toISOString(),
    })),
  });
});

assessorRouter.post("/assignments/:assignmentId/rerun-tests", async (req, res) => {
  const assignment = await prisma.examAssignment.findUnique({
    where: { id: req.params.assignmentId },
    include: {
      workspace: {
        include: {
          submissions: {
            where: { isFinal: true },
            orderBy: { submittedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  const sub = assignment?.workspace?.submissions[0];
  if (!sub) {
    res.status(400).json({ error: "No final submission" });
    return;
  }
  const auto = await runAutoAssessmentForSubmission(sub.id);
  await ensureAssessorReviewStub(assignment!.id, sub.id, auto.scorePercent);
  res.json({
    scorePercent: auto.scorePercent,
    earnedPoints: auto.earnedPoints,
    maxPoints: auto.maxPoints,
    ranAt: auto.ranAt.toISOString(),
    report: JSON.parse(auto.reportJson),
  });
});

assessorRouter.post("/assignments/:assignmentId/review", async (req: AuthedAdminRequest, res) => {
  const { finalScorePercent, feedback } = req.body as {
    finalScorePercent?: unknown;
    feedback?: unknown;
  };
  if (typeof finalScorePercent !== "number" || finalScorePercent < 0 || finalScorePercent > 100) {
    res.status(400).json({ error: "finalScorePercent must be 0–100" });
    return;
  }
  const feedbackStr = typeof feedback === "string" ? feedback.trim() : "";

  const assignment = await prisma.examAssignment.findUnique({
    where: { id: req.params.assignmentId },
    include: {
      workspace: {
        include: {
          submissions: {
            where: { isFinal: true },
            orderBy: { submittedAt: "desc" },
            take: 1,
            include: { autoAssessment: true },
          },
        },
      },
      assessorReview: true,
    },
  });
  if (!assignment) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }
  const sub = assignment.workspace?.submissions[0];
  if (!sub) {
    res.status(400).json({ error: "No submission to review" });
    return;
  }
  const automated = sub.autoAssessment?.scorePercent ?? assignment.assessorReview?.automatedScorePercent ?? 0;

  const review = await prisma.practicalAssessorReview.upsert({
    where: { assignmentId: assignment.id },
    create: {
      assignmentId: assignment.id,
      submissionId: sub.id,
      automatedScorePercent: automated,
      finalScorePercent,
      feedback: feedbackStr,
    },
    update: {
      submissionId: sub.id,
      automatedScorePercent: automated,
      finalScorePercent,
      feedback: feedbackStr,
    },
  });

  await prisma.practicalAssessorReviewLog.create({
    data: {
      assignmentId: assignment.id,
      submissionId: sub.id,
      automatedScorePercent: automated,
      finalScorePercent,
      feedback: feedbackStr,
    },
  });

  await recordAuditLog({
    adminId: req.admin!.id,
    action: "ASSESSOR_REVIEW_SUBMITTED",
    targetType: "ExamAssignment",
    targetId: assignment.id,
    detail: `finalScorePercent=${finalScorePercent}`,
  });

  res.json({
    automatedScorePercent: review.automatedScorePercent,
    finalScorePercent: review.finalScorePercent,
    feedback: review.feedback,
    updatedAt: review.updatedAt.toISOString(),
  });
});
