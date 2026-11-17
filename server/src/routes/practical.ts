import { AssignmentStatus } from "@prisma/client";
import { type Request, Router } from "express";
import { prisma } from "../prisma.js";
import { type AuthedRequest, requireStudent } from "../middleware/studentAuth.js";
import {
  ensureAssessorReviewStub,
  runAutoAssessmentForSubmission,
} from "../lib/runAutoAssessment.js";
import { runInSandbox } from "../lib/sandboxRunner.js";
import {
  ensurePracticalWorkspace,
  filesToSnapshot,
  getAssignmentForStudent,
  isValidFilename,
} from "../lib/practical.js";
import { withPrismaWriteConflictRetry } from "../lib/prismaWriteConflict.js";
import { getExamAssetStorageProvider } from "../lib/storage/examAssetStorage.js";
import { forwardAsyncErrorsOnRouter } from "../middleware/forwardAsyncErrors.js";

export const practicalStudentRouter = Router({ mergeParams: true });
export const practicalAssessorRouter = Router({ mergeParams: true });

function mapWorkspace(ws: {
  id: string;
  assignmentId: string;
  studentId: string;
  activeFile: string;
  startedAt: Date;
  lockedAt: Date | null;
  lastSavedAt: Date;
  files: { id: string; filename: string; content: string; updatedAt: Date }[];
}) {
  return {
    id: ws.id,
    assignmentId: ws.assignmentId,
    studentId: ws.studentId,
    activeFile: ws.activeFile,
    startedAt: ws.startedAt.toISOString(),
    lockedAt: ws.lockedAt?.toISOString() ?? null,
    lastSavedAt: ws.lastSavedAt.toISOString(),
    locked: ws.lockedAt != null,
    files: ws.files.map((f) => ({
      id: f.id,
      filename: f.filename,
      content: f.content,
      updatedAt: f.updatedAt.toISOString(),
    })),
  };
}

type PracticalAccessResult =
  | { error: string; status: number }
  | { assignment: NonNullable<Awaited<ReturnType<typeof getAssignmentForStudent>>> };

async function assertPracticalAccess(
  req: AuthedRequest,
  assignmentId: string
): Promise<PracticalAccessResult> {
  const assignment = await getAssignmentForStudent(assignmentId, req.studentId!);
  if (!assignment) return { error: "Assignment not found", status: 404 };
  if (assignment.exam.type !== "PRACTICAL") {
    return { error: "Not a practical exam", status: 400 };
  }
  return { assignment };
}

practicalStudentRouter.use(requireStudent);

practicalStudentRouter.get("/", async (req: AuthedRequest, res) => {
  const assignmentId = req.params.assignmentId!;
  const gate = await assertPracticalAccess(req, assignmentId);
  if ("error" in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }
  const ws = await ensurePracticalWorkspace(assignmentId, req.studentId!);
  if (gate.assignment.status === AssignmentStatus.ASSIGNED) {
    await prisma.examAssignment.update({
      where: { id: assignmentId },
      data: { status: AssignmentStatus.IN_PROGRESS },
    });
  }
  const full = await prisma.practicalWorkspace.findUniqueOrThrow({
    where: { id: ws.id },
    include: { files: true },
  });
  const questions = await prisma.practicalQuestion.findMany({
    where: { examId: gate.assignment.examId },
    orderBy: { sortOrder: "asc" },
  });
  res.json({
    exam: {
      title: gate.assignment.exam.title,
      instructions: gate.assignment.exam.instructions,
      durationMinutes: gate.assignment.exam.durationMinutes,
      // Safe fields only — never expression/isHidden (no answer-key leak).
      questions: questions.map((q) => ({
        id: q.id,
        title: q.title,
        scenario: q.scenario,
        instructions: q.instructions,
        requirements: JSON.parse(q.requirements) as string[],
        marks: q.marks,
        difficulty: q.difficulty,
        sortOrder: q.sortOrder,
      })),
    },
    workspace: mapWorkspace(full),
  });
});

/**
 * Runs ONLY the exam's PUBLIC (isHidden=false) test cases against the
 * student's CURRENT workspace files and returns the report directly — an
 * ephemeral "practice run" the student can use as often as they like while
 * working. Hidden test cases never run and never appear in this response —
 * not their label, not their count, nothing. Never persists a
 * PracticalSubmission or PracticalAutoAssessment row and never affects the
 * assignment's status/lock/final score — only POST /submit does that.
 */
practicalStudentRouter.post("/run-tests", async (req: AuthedRequest, res) => {
  const assignmentId = req.params.assignmentId!;
  const gate = await assertPracticalAccess(req, assignmentId);
  if ("error" in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }
  const ws = await ensurePracticalWorkspace(assignmentId, req.studentId!);
  const full = await prisma.practicalWorkspace.findUniqueOrThrow({
    where: { id: ws.id },
    include: { files: true },
  });
  const exam = await prisma.exam.findUniqueOrThrow({
    where: { id: gate.assignment.examId },
    include: { practicalTests: { orderBy: { sortOrder: "asc" } } },
  });
  if (exam.practicalTests.length === 0) {
    res.json({ results: [], earnedPoints: 0, maxPoints: 0, scorePercent: 0, note: "No test cases defined for this exam." });
    return;
  }

  const publicTests = exam.practicalTests.filter((t) => !t.isHidden);

  if (publicTests.length === 0) {
    res.json({ results: [], earnedPoints: 0, maxPoints: 0, scorePercent: 0, note: "No public sample test cases defined for this exam." });
    return;
  }

  const files = full.files.map((f) => ({ filename: f.filename, content: f.content }));
  const report = await runInSandbox(
    files,
    publicTests.map((t) => ({
      id: t.id,
      label: t.label,
      kind: t.kind,
      targetFile: t.targetFile,
      expression: t.expression,
      points: t.points,
      questionId: t.questionId,
    }))
  );
  res.json(report);
});

/**
 * Lists every PracticalQuestionReferenceAsset across the assignment's exam,
 * flattened — not filtered by anything, since a question's reference
 * material describes the question itself, which the student must solve
 * regardless of which (if any) test case ended up attached to it.
 */
practicalStudentRouter.get("/practical-questions/assets", async (req: AuthedRequest, res) => {
  const assignmentId = req.params.assignmentId!;
  const gate = await assertPracticalAccess(req, assignmentId);
  if ("error" in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }
  const assets = await prisma.practicalQuestionReferenceAsset.findMany({
    where: { question: { examId: gate.assignment.examId } },
    orderBy: { createdAt: "asc" },
  });
  res.json(
    assets.map((a) => ({
      questionId: a.questionId,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
    }))
  );
});

practicalStudentRouter.get(
  "/practical-questions/assets/:questionId/:filename",
  async (req: AuthedRequest, res) => {
    const assignmentId = req.params.assignmentId!;
    const gate = await assertPracticalAccess(req, assignmentId);
    if ("error" in gate) {
      res.status(gate.status).json({ error: gate.error });
      return;
    }
    const asset = await prisma.practicalQuestionReferenceAsset.findUnique({
      where: {
        questionId_filename: { questionId: req.params.questionId, filename: req.params.filename },
      },
      include: { question: true },
    });
    if (!asset || asset.question.examId !== gate.assignment.examId) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    const provider = getExamAssetStorageProvider();
    if (!(await provider.exists(asset.storageKey))) {
      res.status(404).json({ error: "File not found in storage" });
      return;
    }
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${asset.filename}"`);
    const stream = await provider.getStream(asset.storageKey);
    stream.on("error", () => {
      if (!res.headersSent) res.status(404).json({ error: "File not found in storage" });
      else res.destroy();
    });
    stream.pipe(res);
  }
);

practicalStudentRouter.put("/autosave", async (req: AuthedRequest, res) => {
  const assignmentId = req.params.assignmentId!;
  const gate = await assertPracticalAccess(req, assignmentId);
  if ("error" in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }
  const ws = await ensurePracticalWorkspace(assignmentId, req.studentId!);
  if (ws.lockedAt) {
    res.status(400).json({ error: "Submission locked" });
    return;
  }

  const { files, activeFile } = req.body as {
    files?: { filename: string; content: string }[];
    activeFile?: string;
  };
  if (!Array.isArray(files)) {
    res.status(400).json({ error: "files array required" });
    return;
  }
  for (const f of files) {
    if (typeof f.filename !== "string" || typeof f.content !== "string") {
      res.status(400).json({ error: "Invalid file entry" });
      return;
    }
    if (!isValidFilename(f.filename)) {
      res.status(400).json({ error: `Invalid filename: ${f.filename}` });
      return;
    }
  }
  if (activeFile !== undefined && !isValidFilename(activeFile)) {
    res.status(400).json({ error: "Invalid active file" });
    return;
  }

  const now = new Date();
  await withPrismaWriteConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      for (const f of files) {
        await tx.practicalFile.upsert({
          where: {
            workspaceId_filename: { workspaceId: ws.id, filename: f.filename },
          },
          create: { workspaceId: ws.id, filename: f.filename, content: f.content },
          update: { content: f.content },
        });
      }
      await tx.practicalWorkspace.update({
        where: { id: ws.id },
        data: {
          lastSavedAt: now,
          ...(activeFile ? { activeFile } : {}),
        },
      });
      if (gate.assignment.status === AssignmentStatus.ASSIGNED) {
        await tx.examAssignment.update({
          where: { id: assignmentId },
          data: { status: AssignmentStatus.IN_PROGRESS },
        });
      }
    })
  );

  const full = await prisma.practicalWorkspace.findUniqueOrThrow({
    where: { id: ws.id },
    include: { files: true },
  });
  res.json({ savedAt: now.toISOString(), workspace: mapWorkspace(full) });
});

practicalStudentRouter.post("/files", async (req: AuthedRequest, res) => {
  const assignmentId = req.params.assignmentId!;
  const gate = await assertPracticalAccess(req, assignmentId);
  if ("error" in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }
  const ws = await ensurePracticalWorkspace(assignmentId, req.studentId!);
  if (ws.lockedAt) {
    res.status(400).json({ error: "Submission locked" });
    return;
  }
  const { filename } = req.body as { filename?: string };
  if (typeof filename !== "string" || !isValidFilename(filename)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  try {
    const file = await prisma.practicalFile.create({
      data: { workspaceId: ws.id, filename, content: "" },
    });
    res.status(201).json(file);
  } catch {
    res.status(400).json({ error: "File already exists" });
  }
});

practicalStudentRouter.patch("/files/:filename", async (req: AuthedRequest, res) => {
  const assignmentId = req.params.assignmentId!;
  const oldName = req.params.filename;
  const gate = await assertPracticalAccess(req, assignmentId);
  if ("error" in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }
  const ws = await ensurePracticalWorkspace(assignmentId, req.studentId!);
  if (ws.lockedAt) {
    res.status(400).json({ error: "Submission locked" });
    return;
  }
  const { newName } = req.body as { newName?: string };
  if (typeof newName !== "string" || !isValidFilename(newName)) {
    res.status(400).json({ error: "Invalid new filename" });
    return;
  }
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.practicalFile.findUniqueOrThrow({
        where: { workspaceId_filename: { workspaceId: ws.id, filename: oldName } },
      });
      await tx.practicalFile.create({
        data: { workspaceId: ws.id, filename: newName, content: existing.content },
      });
      await tx.practicalFile.delete({ where: { id: existing.id } });
      const current = await tx.practicalWorkspace.findUniqueOrThrow({ where: { id: ws.id } });
      if (current.activeFile === oldName) {
        await tx.practicalWorkspace.update({
          where: { id: ws.id },
          data: { activeFile: newName },
        });
      }
    });
    res.json({ ok: true, filename: newName });
  } catch {
    res.status(404).json({ error: "File not found or name taken" });
  }
});

practicalStudentRouter.delete("/files/:filename", async (req: AuthedRequest, res) => {
  const assignmentId = req.params.assignmentId!;
  const filename = req.params.filename;
  const gate = await assertPracticalAccess(req, assignmentId);
  if ("error" in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }
  const ws = await ensurePracticalWorkspace(assignmentId, req.studentId!);
  if (ws.lockedAt) {
    res.status(400).json({ error: "Submission locked" });
    return;
  }
  const count = await prisma.practicalFile.count({ where: { workspaceId: ws.id } });
  if (count <= 1) {
    res.status(400).json({ error: "Keep at least one file" });
    return;
  }
  try {
    await prisma.practicalFile.delete({
      where: { workspaceId_filename: { workspaceId: ws.id, filename } },
    });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

practicalStudentRouter.post("/submit", async (req: AuthedRequest, res) => {
  const assignmentId = req.params.assignmentId!;
  const gate = await assertPracticalAccess(req, assignmentId);
  if ("error" in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }
  const ws = await prisma.practicalWorkspace.findUnique({
    where: { assignmentId },
    include: { files: true },
  });
  if (!ws) {
    res.status(400).json({ error: "Workspace not found" });
    return;
  }
  if (ws.lockedAt) {
    res.status(400).json({ error: "Already submitted" });
    return;
  }

  const now = new Date();
  const snapshot = filesToSnapshot(
    ws.files.map((f) => ({ filename: f.filename, content: f.content }))
  );

  let submission;
  try {
    submission = await prisma.$transaction(async (tx) => {
      const guard = await tx.practicalWorkspace.updateMany({
        where: { id: ws.id, lockedAt: null },
        data: { lockedAt: now, lastSavedAt: now },
      });
      if (guard.count === 0) {
        throw new Error("ALREADY_SUBMITTED");
      }
      const sub = await tx.practicalSubmission.create({
        data: {
          workspaceId: ws.id,
          assignmentId,
          studentId: req.studentId!,
          filesSnapshot: snapshot,
          isFinal: true,
        },
      });
      await tx.examAssignment.update({
        where: { id: assignmentId },
        data: { status: AssignmentStatus.SUBMITTED },
      });
      return sub;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ALREADY_SUBMITTED") {
      res.status(400).json({ error: "Already submitted" });
      return;
    }
    throw e;
  }

  let automated: { scorePercent: number; earnedPoints: number; maxPoints: number } | null = null;
  try {
    const auto = await runAutoAssessmentForSubmission(submission.id);
    await ensureAssessorReviewStub(assignmentId, submission.id, auto.scorePercent);
    automated = {
      scorePercent: auto.scorePercent,
      earnedPoints: auto.earnedPoints,
      maxPoints: auto.maxPoints,
    };
  } catch {
    // submission stands; assessor may re-run tests
  }

  res.json({
    submittedAt: now.toISOString(),
    locked: true,
    automated,
  });
});

practicalAssessorRouter.get("/history", async (req: Request<{ assignmentId: string }>, res) => {
  const assignmentId = req.params.assignmentId;
  const assignment = await prisma.examAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      exam: true,
      student: true,
      workspace: true,
    },
  });
  if (!assignment || assignment.exam.type !== "PRACTICAL") {
    res.status(404).json({ error: "Practical assignment not found" });
    return;
  }
  const workspace = assignment.workspace;
  if (!workspace) {
    res.json({ assignment, submissions: [] });
    return;
  }
  const submissions = await prisma.practicalSubmission.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { submittedAt: "desc" },
  });
  res.json({
    assignment: {
      id: assignment.id,
      status: assignment.status,
      student: assignment.student,
      exam: assignment.exam,
    },
    submissions: submissions.map((s) => ({
      id: s.id,
      submittedAt: s.submittedAt.toISOString(),
      isFinal: s.isFinal,
      files: JSON.parse(s.filesSnapshot) as { filename: string; content: string }[],
    })),
  });
});

forwardAsyncErrorsOnRouter(practicalStudentRouter);
