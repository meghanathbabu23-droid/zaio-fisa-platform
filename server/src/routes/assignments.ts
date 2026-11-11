import { Router } from "express";
import { ensureEvidenceRecord, syncEvidenceForAssignment } from "../lib/evidenceSync.js";
import { prisma } from "../prisma.js";

export const assignmentsRouter = Router();

assignmentsRouter.get("/", async (_req, res) => {
  const assignments = await prisma.examAssignment.findMany({
    include: {
      exam: true,
      student: { include: { cohort: true } },
      attempt: true,
      workspace: { select: { lockedAt: true, lastSavedAt: true } },
    },
    orderBy: { assignedAt: "desc" },
  });
  res.json(assignments);
});

assignmentsRouter.post("/", async (req, res) => {
  const { examId, studentId } = req.body as Record<string, unknown>;
  if (typeof examId !== "string" || typeof studentId !== "string") {
    res.status(400).json({ error: "examId and studentId required" });
    return;
  }
  try {
    const assignment = await prisma.examAssignment.create({
      data: { examId, studentId },
      include: { exam: true, student: { include: { cohort: true } } },
    });
    await ensureEvidenceRecord(assignment.id);
    await syncEvidenceForAssignment(assignment.id);
    res.status(201).json(assignment);
  } catch {
    res.status(400).json({ error: "Assignment already exists or invalid references" });
  }
});

assignmentsRouter.post("/bulk-cohort", async (req, res) => {
  const { examId, cohortId } = req.body as Record<string, unknown>;
  if (typeof examId !== "string" || typeof cohortId !== "string") {
    res.status(400).json({ error: "examId and cohortId required" });
    return;
  }
  const students = await prisma.student.findMany({ where: { cohortId } });
  if (students.length === 0) {
    res.status(400).json({ error: "No students in cohort" });
    return;
  }
  const created = await prisma.$transaction(
    students.map((s) =>
      prisma.examAssignment.upsert({
        where: { examId_studentId: { examId, studentId: s.id } },
        create: { examId, studentId: s.id },
        update: {},
      })
    )
  );
  for (const row of created) {
    await ensureEvidenceRecord(row.id);
    await syncEvidenceForAssignment(row.id);
  }
  res.status(201).json({ count: created.length });
});

assignmentsRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.examAssignment.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: "Assignment not found" });
  }
});
