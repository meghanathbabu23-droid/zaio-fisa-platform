import { AssignmentStatus } from "@prisma/client";
import { type Request, Router } from "express";
import { prisma } from "../prisma.js";
import { type AuthedRequest, requireStudent } from "../middleware/studentAuth.js";
import {
  ensureAssessorReviewStub,
  runAutoAssessmentForSubmission,
} from "../lib/runAutoAssessment.js";
import { runPracticalTests } from "../lib/practicalRunner.js";
import {
  ensurePracticalWorkspace,
  filesToSnapshot,
  getAssignmentForStudent,
  isValidFilename,
} from "../lib/practical.js";

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
  res.json({
    exam: {
      title: gate.assignment.exam.title,
      instructions: gate.assignment.exam.instructions,
      durationMinutes: gate.assignment.exam.durationMinutes,
    },
    workspace: mapWorkspace(full),
  });
});

/**
 * Runs the exam's test cases against the student's CURRENT workspace
 * files and returns the report directly — an ephemeral "practice run" the
 * student can use as often as they like while working. Never persists a
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

  const files = full.files.map((f) => ({ filename: f.filename, content: f.content }));
  const report = runPracticalTests(
    files,
    exam.practicalTests.map((t) => ({
      id: t.id,
      label: t.label,
      kind: t.kind,
      targetFile: t.targetFile,
      expression: t.expression,
      points: t.points,
    }))
  );
  res.json(report);
});

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
  await prisma.$transaction(async (tx) => {
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
  });

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
