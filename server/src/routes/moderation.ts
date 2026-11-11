import { ExamType, ModerationStatus } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../prisma.js";
import { computeAdvisoryFlags } from "../lib/moderationFlags.js";
import { recordAuditLog } from "../lib/auditLog.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";

export const moderationRouter = Router();

async function loadPracticalAssignment(assignmentId: string) {
  return prisma.examAssignment.findFirst({
    where: { id: assignmentId, exam: { type: ExamType.PRACTICAL } },
    include: {
      student: { include: { cohort: true } },
      exam: true,
      assessorReview: true,
      moderationCase: { include: { records: { orderBy: { createdAt: "desc" } } } },
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
}

async function ensureCase(assignmentId: string, flagsJson: string) {
  return prisma.moderationCase.upsert({
    where: { assignmentId },
    create: { assignmentId, advisoryFlagsJson: flagsJson },
    update: { advisoryFlagsJson: flagsJson },
    include: { records: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
}

moderationRouter.get("/", async (req, res) => {
  const statusFilter =
    typeof req.query.status === "string" &&
    ["PENDING", "REVIEWED", "COMPLETED"].includes(req.query.status)
      ? (req.query.status as ModerationStatus)
      : undefined;

  const assignments = await prisma.examAssignment.findMany({
    where: {
      exam: { type: ExamType.PRACTICAL },
      OR: [{ status: "SUBMITTED" }, { assessorReview: { isNot: null } }],
    },
    include: {
      student: { include: { cohort: true } },
      exam: true,
      assessorReview: true,
      moderationCase: true,
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
    orderBy: { updatedAt: "desc" },
  });

  const allItems: {
    moderationStatus: ModerationStatus;
  }[] = [];
  const items = [];
  for (const a of assignments) {
    const sub = a.workspace?.submissions[0];
    const auto = sub?.autoAssessment?.scorePercent ?? null;
    const assessor = a.assessorReview?.finalScorePercent ?? null;
    const flags = computeAdvisoryFlags({
      status: a.status,
      submitted: a.status === "SUBMITTED",
      automatedScore: auto,
      assessorScore: assessor,
    });
    const flagsJson = JSON.stringify(flags);
    const modCase = await ensureCase(a.id, flagsJson);
    allItems.push({ moderationStatus: modCase.status });

    if (statusFilter && modCase.status !== statusFilter) continue;

    items.push({
      assignmentId: a.id,
      studentName: `${a.student.firstName} ${a.student.lastName}`,
      cohortName: a.student.cohort.name,
      examTitle: a.exam.title,
      submittedAt: sub?.submittedAt.toISOString() ?? null,
      automatedScorePercent: auto,
      assessorApprovedPercent: assessor,
      moderationStatus: modCase.status,
      advisoryFlags: flags,
      flagCount: flags.length,
    });
  }

  const counts = {
    pending: allItems.filter((i) => i.moderationStatus === "PENDING").length,
    reviewed: allItems.filter((i) => i.moderationStatus === "REVIEWED").length,
    completed: allItems.filter((i) => i.moderationStatus === "COMPLETED").length,
  };

  res.json({ counts, items });
});

moderationRouter.get("/:assignmentId", async (req, res) => {
  const assignment = await loadPracticalAssignment(req.params.assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "Practical assignment not found" });
    return;
  }

  const submission = assignment.workspace?.submissions[0];
  const auto = submission?.autoAssessment;
  const flags = computeAdvisoryFlags({
    status: assignment.status,
    submitted: assignment.status === "SUBMITTED",
    automatedScore: auto?.scorePercent ?? null,
    assessorScore: assignment.assessorReview?.finalScorePercent ?? null,
  });
  const modCase = await ensureCase(assignment.id, JSON.stringify(flags));

  const allRecords = await prisma.moderationRecord.findMany({
    where: { caseId: modCase.id },
    orderBy: { createdAt: "desc" },
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
          files: JSON.parse(submission.filesSnapshot) as { filename: string; content: string }[],
        }
      : null,
    automated: auto
      ? {
          scorePercent: auto.scorePercent,
          earnedPoints: auto.earnedPoints,
          maxPoints: auto.maxPoints,
          ranAt: auto.ranAt.toISOString(),
          report: JSON.parse(auto.reportJson),
        }
      : null,
    assessorReview: assignment.assessorReview
      ? {
          automatedScorePercent: assignment.assessorReview.automatedScorePercent,
          finalScorePercent: assignment.assessorReview.finalScorePercent,
          feedback: assignment.assessorReview.feedback,
          updatedAt: assignment.assessorReview.updatedAt.toISOString(),
        }
      : null,
    moderation: {
      status: modCase.status,
      advisoryFlags: flags,
      history: allRecords.map((r) => ({
        id: r.id,
        moderatorName: r.moderatorName,
        decision: r.decision,
        comments: r.comments,
        statusAfter: r.statusAfter,
        createdAt: r.createdAt.toISOString(),
      })),
    },
  });
});

moderationRouter.post("/:assignmentId/decide", async (req: AuthedAdminRequest, res) => {
  const { moderatorName, decision, comments, status } = req.body as Record<string, unknown>;
  if (typeof moderatorName !== "string" || !moderatorName.trim()) {
    res.status(400).json({ error: "moderatorName required" });
    return;
  }
  if (typeof decision !== "string" || !decision.trim()) {
    res.status(400).json({ error: "decision required" });
    return;
  }
  if (
    status !== "PENDING" &&
    status !== "REVIEWED" &&
    status !== "COMPLETED"
  ) {
    res.status(400).json({ error: "status must be PENDING, REVIEWED, or COMPLETED" });
    return;
  }

  const assignment = await loadPracticalAssignment(req.params.assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const flags = computeAdvisoryFlags({
    status: assignment.status,
    submitted: assignment.status === "SUBMITTED",
    automatedScore: assignment.workspace?.submissions[0]?.autoAssessment?.scorePercent ?? null,
    assessorScore: assignment.assessorReview?.finalScorePercent ?? null,
  });

  const modCase = await ensureCase(assignment.id, JSON.stringify(flags));

  const commentsStr = typeof comments === "string" ? comments.trim() : "";

  const [record, updatedCase] = await prisma.$transaction([
    prisma.moderationRecord.create({
      data: {
        caseId: modCase.id,
        assignmentId: assignment.id,
        moderatorName: moderatorName.trim(),
        decision: decision.trim(),
        comments: commentsStr,
        statusAfter: status as ModerationStatus,
      },
    }),
    prisma.moderationCase.update({
      where: { id: modCase.id },
      data: { status: status as ModerationStatus },
    }),
  ]);

  await recordAuditLog({
    adminId: req.admin!.id,
    action: "MODERATION_DECISION_RECORDED",
    targetType: "ExamAssignment",
    targetId: assignment.id,
    detail: `decision=${decision.trim()};status=${status}`,
  });

  res.status(201).json({
    moderationStatus: updatedCase.status,
    record: {
      id: record.id,
      moderatorName: record.moderatorName,
      decision: record.decision,
      comments: record.comments,
      statusAfter: record.statusAfter,
      createdAt: record.createdAt.toISOString(),
    },
  });
});
