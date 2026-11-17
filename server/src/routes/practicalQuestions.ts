import { AdminRole } from "@prisma/client";
import { type Request, Router } from "express";
import { prisma } from "../prisma.js";
import { requireRole } from "../middleware/requireRole.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";
import { recordAuditLog } from "../lib/auditLog.js";
import { examHasAnyAssignment } from "../lib/examImmutability.js";
import { purgePracticalQuestionReferenceAssetStorage } from "../lib/practicalQuestionReferenceAssets.js";

export const practicalQuestionsRouter = Router({ mergeParams: true });
// Same split as practicalTestCasesRouter: question content (title, scenario,
// instructions, requirements, marks, difficulty, grouping/order) is
// effectively exam authoring — ADMIN can read it, only SUPER_ADMIN may
// create, edit, delete, or reorder it.
const writeOnly = requireRole(AdminRole.SUPER_ADMIN);

const DIFFICULTIES = new Set(["EASY", "MEDIUM", "HARD"]);

const LOCKED_MESSAGE =
  "Cannot change questions: this exam already has at least one student assignment. Archive it and create a new exam instead.";

function parseQuestionBody(body: Record<string, unknown>) {
  const { title, scenario, instructions, requirements, marks, difficulty } = body;
  if (typeof title !== "string" || !title.trim()) return null;
  if (requirements !== undefined && !Array.isArray(requirements)) return null;
  if (
    Array.isArray(requirements) &&
    requirements.some((r) => typeof r !== "string")
  ) {
    return null;
  }
  const marksNum = typeof marks === "number" ? Math.trunc(marks) : 0;
  if (!Number.isInteger(marksNum) || marksNum < 0) return null;
  const diff = typeof difficulty === "string" ? difficulty : "MEDIUM";
  if (!DIFFICULTIES.has(diff)) return null;
  return {
    title: title.trim(),
    scenario: typeof scenario === "string" ? scenario : "",
    instructions: typeof instructions === "string" ? instructions : "",
    requirements: JSON.stringify((requirements as string[] | undefined) ?? []),
    marks: marksNum,
    difficulty: diff,
  };
}

practicalQuestionsRouter.get("/", async (req: Request<{ examId: string }>, res) => {
  const { examId } = req.params;
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam || exam.type !== "PRACTICAL") {
    res.status(404).json({ error: "Practical exam not found" });
    return;
  }
  const questions = await prisma.practicalQuestion.findMany({
    where: { examId },
    orderBy: { sortOrder: "asc" },
    include: { testCases: { select: { id: true } } },
  });
  res.json(
    questions.map((q) => ({
      id: q.id,
      examId: q.examId,
      title: q.title,
      scenario: q.scenario,
      instructions: q.instructions,
      requirements: JSON.parse(q.requirements) as string[],
      marks: q.marks,
      difficulty: q.difficulty,
      sortOrder: q.sortOrder,
      testCaseCount: q.testCases.length,
    }))
  );
});

practicalQuestionsRouter.post("/", writeOnly, async (req: AuthedAdminRequest, res) => {
  const data = parseQuestionBody(req.body);
  if (!data) {
    res.status(400).json({ error: "Invalid question" });
    return;
  }
  const exam = await prisma.exam.findUnique({ where: { id: req.params.examId } });
  if (!exam || exam.type !== "PRACTICAL") {
    res.status(404).json({ error: "Practical exam not found" });
    return;
  }
  if (await examHasAnyAssignment(exam.id)) {
    res.status(409).json({ error: LOCKED_MESSAGE });
    return;
  }
  const count = await prisma.practicalQuestion.count({ where: { examId: exam.id } });
  const row = await prisma.practicalQuestion.create({
    data: { examId: exam.id, ...data, sortOrder: count },
  });
  await recordAuditLog({
    adminId: req.admin!.id,
    action: "PRACTICAL_QUESTION_CREATED",
    targetType: "PracticalQuestion",
    targetId: row.id,
  });
  res.status(201).json({
    id: row.id,
    examId: row.examId,
    title: row.title,
    scenario: row.scenario,
    instructions: row.instructions,
    requirements: JSON.parse(row.requirements) as string[],
    marks: row.marks,
    difficulty: row.difficulty,
    sortOrder: row.sortOrder,
    testCaseCount: 0,
  });
});

practicalQuestionsRouter.put("/:questionId", writeOnly, async (req: AuthedAdminRequest, res) => {
  const data = parseQuestionBody(req.body);
  if (!data) {
    res.status(400).json({ error: "Invalid question" });
    return;
  }
  const existing = await prisma.practicalQuestion.findUnique({ where: { id: req.params.questionId } });
  if (!existing) {
    res.status(404).json({ error: "Question not found" });
    return;
  }
  if (await examHasAnyAssignment(existing.examId)) {
    res.status(409).json({ error: LOCKED_MESSAGE });
    return;
  }
  const row = await prisma.practicalQuestion.update({
    where: { id: req.params.questionId },
    data,
  });
  await recordAuditLog({
    adminId: req.admin!.id,
    action: "PRACTICAL_QUESTION_UPDATED",
    targetType: "PracticalQuestion",
    targetId: row.id,
  });
  const testCaseCount = await prisma.practicalTestCase.count({ where: { questionId: row.id } });
  res.json({
    id: row.id,
    examId: row.examId,
    title: row.title,
    scenario: row.scenario,
    instructions: row.instructions,
    requirements: JSON.parse(row.requirements) as string[],
    marks: row.marks,
    difficulty: row.difficulty,
    sortOrder: row.sortOrder,
    testCaseCount,
  });
});

practicalQuestionsRouter.delete("/:questionId", writeOnly, async (req: AuthedAdminRequest, res) => {
  const existing = await prisma.practicalQuestion.findUnique({ where: { id: req.params.questionId } });
  if (!existing) {
    res.status(404).json({ error: "Question not found" });
    return;
  }
  if (await examHasAnyAssignment(existing.examId)) {
    res.status(409).json({ error: LOCKED_MESSAGE });
    return;
  }
  // Storage bytes for this question's reference assets first (the DB rows
  // cascade-delete automatically) — never leave untracked physical files.
  await purgePracticalQuestionReferenceAssetStorage(existing.id);
  await prisma.practicalQuestion.delete({ where: { id: req.params.questionId } });
  await recordAuditLog({
    adminId: req.admin!.id,
    action: "PRACTICAL_QUESTION_DELETED",
    targetType: "PracticalQuestion",
    targetId: req.params.questionId,
  });
  res.status(204).send();
});

/**
 * Swaps this question's sortOrder with the adjacent sibling in the given
 * direction — the simplest reorder primitive that needs no new ordering
 * scheme (no gaps/fractional ordering), matching this codebase's existing
 * convention of plain integer sortOrder fields with no reorder UI
 * precedent to otherwise follow.
 */
practicalQuestionsRouter.post("/:questionId/reorder", writeOnly, async (req: AuthedAdminRequest, res) => {
  const { direction } = req.body as { direction?: unknown };
  if (direction !== "up" && direction !== "down") {
    res.status(400).json({ error: "direction must be 'up' or 'down'" });
    return;
  }
  const existing = await prisma.practicalQuestion.findUnique({ where: { id: req.params.questionId } });
  if (!existing) {
    res.status(404).json({ error: "Question not found" });
    return;
  }
  if (await examHasAnyAssignment(existing.examId)) {
    res.status(409).json({ error: LOCKED_MESSAGE });
    return;
  }
  const siblings = await prisma.practicalQuestion.findMany({
    where: { examId: existing.examId },
    orderBy: { sortOrder: "asc" },
  });
  const index = siblings.findIndex((s) => s.id === existing.id);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= siblings.length) {
    res.json({ ok: true, moved: false });
    return;
  }
  const other = siblings[swapIndex]!;
  await prisma.$transaction([
    prisma.practicalQuestion.update({ where: { id: existing.id }, data: { sortOrder: other.sortOrder } }),
    prisma.practicalQuestion.update({ where: { id: other.id }, data: { sortOrder: existing.sortOrder } }),
  ]);
  res.json({ ok: true, moved: true });
});
