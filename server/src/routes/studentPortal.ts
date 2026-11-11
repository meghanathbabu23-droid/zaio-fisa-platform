import { AssignmentStatus, Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../prisma.js";
import { type AuthedRequest, requireStudent } from "../middleware/studentAuth.js";

export const studentPortalRouter = Router();

studentPortalRouter.use(requireStudent);

studentPortalRouter.get("/me", async (req: AuthedRequest, res) => {
  const student = await prisma.student.findUnique({
    where: { id: req.studentId! },
    include: { cohort: true },
  });
  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  res.json(student);
});

studentPortalRouter.get("/assignments", async (req: AuthedRequest, res) => {
  const assignments = await prisma.examAssignment.findMany({
    where: { studentId: req.studentId! },
    include: {
      exam: true,
      attempt: true,
      workspace: { select: { lockedAt: true, lastSavedAt: true, activeFile: true } },
    },
    orderBy: { assignedAt: "desc" },
  });
  res.json(assignments);
});

function remainingSeconds(startedAt: Date, durationMinutes: number): number {
  const end = startedAt.getTime() + durationMinutes * 60 * 1000;
  return Math.max(0, Math.floor((end - Date.now()) / 1000));
}

studentPortalRouter.post("/assignments/:id/start", async (req: AuthedRequest, res) => {
  const assignment = await prisma.examAssignment.findFirst({
    where: { id: req.params.id, studentId: req.studentId! },
    include: { exam: true, attempt: true },
  });
  if (!assignment) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }
  if (assignment.exam.type === "PRACTICAL") {
    res.status(400).json({
      error: "Use GET /api/student/assignments/:id/practical to open the practical workspace",
    });
    return;
  }
  if (assignment.exam.type !== "MCQ") {
    res.status(400).json({ error: "Unsupported exam type" });
    return;
  }
  if (assignment.status === AssignmentStatus.SUBMITTED) {
    res.status(400).json({ error: "Already submitted" });
    return;
  }

  let attempt = assignment.attempt;
  if (!attempt) {
    try {
      attempt = await prisma.mcqAttempt.create({
        data: { assignmentId: assignment.id },
      });
      await prisma.examAssignment.update({
        where: { id: assignment.id },
        data: { status: AssignmentStatus.IN_PROGRESS },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        attempt = await prisma.mcqAttempt.findUnique({
          where: { assignmentId: assignment.id },
        });
      } else {
        console.error(e);
        res.status(500).json({ error: "Could not start exam" });
        return;
      }
    }
  }
  if (!attempt) {
    res.status(500).json({ error: "Could not start exam" });
    return;
  }

  res.json({
    assignmentId: assignment.id,
    startedAt: attempt.startedAt.toISOString(),
    durationMinutes: assignment.exam.durationMinutes,
    remainingSeconds: remainingSeconds(attempt.startedAt, assignment.exam.durationMinutes),
  });
});

studentPortalRouter.get("/assignments/:id/exam", async (req: AuthedRequest, res) => {
  const assignment = await prisma.examAssignment.findFirst({
    where: { id: req.params.id, studentId: req.studentId! },
    include: {
      exam: { include: { questions: { orderBy: { sortOrder: "asc" } } } },
      attempt: true,
    },
  });
  if (!assignment?.attempt) {
    res.status(400).json({ error: "Start the exam first" });
    return;
  }
  if (assignment.status === AssignmentStatus.SUBMITTED) {
    res.status(400).json({ error: "Exam already submitted" });
    return;
  }

  const remaining = remainingSeconds(
    assignment.attempt.startedAt,
    assignment.exam.durationMinutes
  );
  if (remaining <= 0) {
    res.status(400).json({ error: "Time expired — submit from the attempts endpoint" });
    return;
  }

  res.json({
    title: assignment.exam.title,
    instructions: assignment.exam.instructions,
    durationMinutes: assignment.exam.durationMinutes,
    remainingSeconds: remaining,
    questions: assignment.exam.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      options: JSON.parse(q.options) as string[],
    })),
  });
});

studentPortalRouter.post("/assignments/:id/submit", async (req: AuthedRequest, res) => {
  const { answers } = req.body as { answers?: unknown };
  if (!Array.isArray(answers)) {
    res.status(400).json({ error: "answers array required" });
    return;
  }

  const assignment = await prisma.examAssignment.findFirst({
    where: { id: req.params.id, studentId: req.studentId! },
    include: {
      exam: { include: { questions: { orderBy: { sortOrder: "asc" } } } },
      attempt: true,
    },
  });
  if (!assignment?.attempt) {
    res.status(400).json({ error: "Exam not started" });
    return;
  }
  if (assignment.status === AssignmentStatus.SUBMITTED) {
    res.status(400).json({ error: "Already submitted" });
    return;
  }

  const questions = assignment.exam.questions;
  if (answers.length !== questions.length) {
    res.status(400).json({ error: "Answer every question" });
    return;
  }

  let correct = 0;
  for (let i = 0; i < questions.length; i++) {
    const a = answers[i];
    if (typeof a !== "number" || !Number.isInteger(a)) {
      res.status(400).json({ error: "Invalid answer index" });
      return;
    }
    if (a === questions[i].correctIndex) correct++;
  }
  const scorePercent = questions.length ? (correct / questions.length) * 100 : 0;

  let attemptResult;
  try {
    attemptResult = await prisma.$transaction(async (tx) => {
      const guard = await tx.examAssignment.updateMany({
        where: { id: assignment.id, status: { not: AssignmentStatus.SUBMITTED } },
        data: { status: AssignmentStatus.SUBMITTED },
      });
      if (guard.count === 0) {
        throw new Error("ALREADY_SUBMITTED");
      }
      return tx.mcqAttempt.update({
        where: { id: assignment.attempt!.id },
        data: {
          answers: JSON.stringify(answers),
          scorePercent,
          submittedAt: new Date(),
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ALREADY_SUBMITTED") {
      res.status(400).json({ error: "Already submitted" });
      return;
    }
    throw e;
  }

  res.json({
    scorePercent,
    correct,
    total: questions.length,
    submittedAt: attemptResult.submittedAt?.toISOString(),
    autoMarked: true,
  });
});
