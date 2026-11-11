import { prisma } from "../prisma.js";
import { runPracticalTests, type WorkspaceFile } from "./practicalRunner.js";

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

  if (testCases.length === 0) {
    const emptyReport = {
      results: [] as unknown[],
      earnedPoints: 0,
      maxPoints: 0,
      scorePercent: 0,
      note: "No test cases defined for this exam.",
    };
    const data = {
      submissionId,
      assignmentId: submission.assignmentId,
      scorePercent: 0,
      earnedPoints: 0,
      maxPoints: 0,
      reportJson: JSON.stringify(emptyReport),
    };
    if (submission.autoAssessment) {
      return prisma.practicalAutoAssessment.update({
        where: { id: submission.autoAssessment.id },
        data: { ...data, ranAt: new Date() },
      });
    }
    return prisma.practicalAutoAssessment.create({ data });
  }

  const report = runPracticalTests(
    files,
    testCases.map((t) => ({
      id: t.id,
      label: t.label,
      kind: t.kind,
      targetFile: t.targetFile,
      expression: t.expression,
      points: t.points,
    }))
  );

  const data = {
    submissionId,
    assignmentId: submission.assignmentId,
    scorePercent: report.scorePercent,
    earnedPoints: report.earnedPoints,
    maxPoints: report.maxPoints,
    reportJson: JSON.stringify(report),
  };

  if (submission.autoAssessment) {
    return prisma.practicalAutoAssessment.update({
      where: { id: submission.autoAssessment.id },
      data: { ...data, ranAt: new Date() },
    });
  }
  return prisma.practicalAutoAssessment.create({ data });
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
