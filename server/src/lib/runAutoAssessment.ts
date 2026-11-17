import { prisma } from "../prisma.js";
import { runInSandbox, type WorkspaceFile } from "./sandboxRunner.js";

export async function runAutoAssessmentForSubmission(submissionId: string) {
  const submission = await prisma.practicalSubmission.findUnique({
    where: { id: submissionId },
    include: {
      autoAssessment: true,
    },
  });
  if (!submission) throw new Error("Submission not found");

  const assignment = await prisma.examAssignment.findUnique({
    where: { id: submission.assignmentId },
    include: { exam: { include: { practicalTests: { orderBy: { sortOrder: "asc" } } } } },
  });
  if (!assignment) throw new Error("Assignment not found");

  const files = JSON.parse(submission.filesSnapshot) as WorkspaceFile[];
  const testCases = assignment.exam.practicalTests;
  const totalMarks = assignment.exam.totalMarks;

  async function save(data: {
    scorePercent: number;
    earnedPoints: number;
    maxPoints: number;
    earnedMarks: number | null;
    maxMarks: number | null;
    executionMode: string;
    reportJson: string;
  }) {
    const full = { submissionId, assignmentId: submission!.assignmentId, ...data };
    if (submission!.autoAssessment) {
      return prisma.practicalAutoAssessment.update({
        where: { id: submission!.autoAssessment.id },
        data: { ...full, ranAt: new Date() },
      });
    }
    return prisma.practicalAutoAssessment.create({ data: full });
  }

  if (testCases.length === 0) {
    return save({
      scorePercent: 0,
      earnedPoints: 0,
      maxPoints: 0,
      earnedMarks: 0,
      maxMarks: totalMarks ?? null,
      executionMode: "static",
      reportJson: JSON.stringify({
        results: [],
        earnedPoints: 0,
        maxPoints: 0,
        scorePercent: 0,
        note: "No test cases defined for this exam.",
      }),
    });
  }

  const report = await runInSandbox(
    files,
    testCases.map((t) => ({
      id: t.id,
      label: t.label,
      kind: t.kind,
      targetFile: t.targetFile,
      expression: t.expression,
      points: t.points,
      questionId: t.questionId,
    }))
  );

  // On a sandbox timeout/error, persist a clearly flagged failure rather
  // than a 0% that looks like a genuine fail — this is exactly the case
  // the assessor manual-override flow exists to catch (see assessor.ts).
  const earnedMarks = totalMarks != null ? (report.scorePercent / 100) * totalMarks : null;
  return save({
    scorePercent: report.scorePercent,
    earnedPoints: report.earnedPoints,
    maxPoints: report.maxPoints,
    earnedMarks,
    maxMarks: totalMarks ?? null,
    executionMode: report.mode,
    reportJson: JSON.stringify(report),
  });
}

export async function ensureAssessorReviewStub(
  assignmentId: string,
  submissionId: string,
  automatedScorePercent: number
) {
  const existing = await prisma.practicalAssessorReview.findUnique({
    where: { assignmentId },
  });
  if (existing) {
    return prisma.practicalAssessorReview.update({
      where: { assignmentId },
      data: {
        submissionId,
        automatedScorePercent,
      },
    });
  }
  return prisma.practicalAssessorReview.create({
    data: {
      assignmentId,
      submissionId,
      automatedScorePercent,
      finalScorePercent: null,
      feedback: "",
    },
  });
}
