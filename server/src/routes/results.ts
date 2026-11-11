import { Router } from "express";
import { prisma } from "../prisma.js";

export const resultsRouter = Router();

export type ResultsRow = {
  assignmentId: string;
  status: string;
  assignedAt: string;
  submittedAt: string | null;
  student: { id: string; firstName: string; lastName: string; email: string };
  cohort: { id: string; name: string };
  exam: { id: string; title: string; type: string };
  mcqScorePercent: number | null;
  practicalAutomatedPercent: number | null;
  assessorApprovedPercent: number | null;
  assessorFeedback: string | null;
  reviewState: "not_started" | "in_progress" | "pending_review" | "finalised";
};

function deriveReviewState(
  examType: string,
  status: string,
  assessorFinal: number | null | undefined
): ResultsRow["reviewState"] {
  if (status === "ASSIGNED") return "not_started";
  if (status === "IN_PROGRESS") return "in_progress";
  if (examType === "PRACTICAL") {
    return assessorFinal != null ? "finalised" : "pending_review";
  }
  // MCQ: auto-marked on submit counts as finalised for reporting
  return status === "SUBMITTED" ? "finalised" : "in_progress";
}

resultsRouter.get("/", async (req, res) => {
  const cohortId = typeof req.query.cohortId === "string" ? req.query.cohortId : undefined;
  const examId = typeof req.query.examId === "string" ? req.query.examId : undefined;
  const studentId = typeof req.query.studentId === "string" ? req.query.studentId : undefined;

  const assignments = await prisma.examAssignment.findMany({
    where: {
      ...(examId ? { examId } : {}),
      ...(studentId ? { studentId } : {}),
      ...(cohortId ? { student: { cohortId } } : {}),
    },
    include: {
      student: { include: { cohort: true } },
      exam: true,
      attempt: true,
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
    orderBy: [{ assignedAt: "desc" }],
  });

  const rows: ResultsRow[] = assignments.map((a) => {
    const sub = a.workspace?.submissions[0];
    const auto = sub?.autoAssessment;
    const submittedAt =
      a.exam.type === "MCQ"
        ? a.attempt?.submittedAt?.toISOString() ?? null
        : sub?.submittedAt.toISOString() ?? null;

    const mcqScore = a.exam.type === "MCQ" ? (a.attempt?.scorePercent ?? null) : null;
    const practicalAuto =
      a.exam.type === "PRACTICAL" ? (auto?.scorePercent ?? null) : null;
    const assessorApproved = a.assessorReview?.finalScorePercent ?? null;
    const feedback = a.assessorReview?.feedback?.trim() || null;

    return {
      assignmentId: a.id,
      status: a.status,
      assignedAt: a.assignedAt.toISOString(),
      submittedAt,
      student: {
        id: a.student.id,
        firstName: a.student.firstName,
        lastName: a.student.lastName,
        email: a.student.email,
      },
      cohort: { id: a.student.cohort.id, name: a.student.cohort.name },
      exam: { id: a.exam.id, title: a.exam.title, type: a.exam.type },
      mcqScorePercent: mcqScore,
      practicalAutomatedPercent: practicalAuto,
      assessorApprovedPercent: assessorApproved,
      assessorFeedback: feedback,
      reviewState: deriveReviewState(a.exam.type, a.status, assessorApproved),
    };
  });

  const summary = {
    total: rows.length,
    submitted: rows.filter((r) => r.status === "SUBMITTED").length,
    inProgress: rows.filter((r) => r.status === "IN_PROGRESS").length,
    notStarted: rows.filter((r) => r.status === "ASSIGNED").length,
    pendingReview: rows.filter((r) => r.reviewState === "pending_review").length,
    finalised: rows.filter((r) => r.reviewState === "finalised").length,
  };

  res.json({ summary, rows });
});
