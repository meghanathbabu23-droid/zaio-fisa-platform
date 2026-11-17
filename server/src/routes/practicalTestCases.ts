import { AdminRole, PracticalTestKind } from "@prisma/client";
import { type Request, Router } from "express";
import { prisma } from "../prisma.js";
import { requireRole } from "../middleware/requireRole.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";
import { recordAuditLog } from "../lib/auditLog.js";
import { examHasAnyAssignment } from "../lib/examImmutability.js";

export const practicalTestCasesRouter = Router({ mergeParams: true });
// Practical test cases are effectively exam answer keys — ADMIN can read
// them (needed for assignment/results context) but only SUPER_ADMIN may
// create, edit, or delete them.
const writeOnly = requireRole(AdminRole.SUPER_ADMIN);

const KINDS = new Set<string>(Object.values(PracticalTestKind));
const DOM_ACTIONS = new Set(["fill", "click", "select", "check", "wait"]);
const DOM_CONDITIONS = new Set(["exists", "notExists", "textContains", "hasClass", "attributeEquals", "countEquals"]);

/** Validates the DOM_BEHAVIOR structured JSON shape stored in `expression`. */
function isValidDomBehaviorSpec(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object") return false;
  const { steps, assert } = parsed as Record<string, unknown>;
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (!step || typeof step !== "object") return false;
    const { action, selector } = step as Record<string, unknown>;
    if (typeof action !== "string" || !DOM_ACTIONS.has(action)) return false;
    if (action !== "wait" && typeof selector !== "string") return false;
  }
  if (!assert || typeof assert !== "object") return false;
  const { selector, condition } = assert as Record<string, unknown>;
  if (typeof selector !== "string" || typeof condition !== "string") return false;
  if (!DOM_CONDITIONS.has(condition)) return false;
  return true;
}

function parseTestBody(body: Record<string, unknown>) {
  const { label, kind, targetFile, expression, points, sortOrder, isHidden, questionId } = body;
  if (typeof label !== "string" || typeof kind !== "string" || typeof expression !== "string") {
    return null;
  }
  if (!label.trim() || !expression.trim() || !KINDS.has(kind)) return null;
  if (kind === PracticalTestKind.DOM_BEHAVIOR && !isValidDomBehaviorSpec(expression.trim())) return null;
  if (questionId !== undefined && questionId !== null && typeof questionId !== "string") return null;
  const pts = typeof points === "number" ? Math.max(1, Math.floor(points)) : 1;
  const order = typeof sortOrder === "number" ? sortOrder : 0;
  const file =
    targetFile === undefined || targetFile === null || targetFile === ""
      ? null
      : typeof targetFile === "string"
        ? targetFile.trim()
        : null;
  return {
    label: label.trim(),
    kind: kind as PracticalTestKind,
    targetFile: file,
    expression: expression.trim(),
    points: pts,
    sortOrder: order,
    // Hidden by default — an admin must explicitly opt a test case into
    // being a public sample by sending isHidden: false.
    isHidden: typeof isHidden === "boolean" ? isHidden : true,
    // Optional grouping under a PracticalQuestion — null/absent means
    // "ungrouped", the backward-compatible default for every existing test
    // case. Membership (same exam) is verified by the caller, not here.
    questionId: (questionId as string | null | undefined) ?? null,
  };
}

/** Verifies a questionId, if provided, actually belongs to the named exam —
 * prevents linking a test case to another exam's question. */
async function validateQuestionBelongsToExam(questionId: string | null, examId: string): Promise<boolean> {
  if (questionId === null) return true;
  const question = await prisma.practicalQuestion.findFirst({ where: { id: questionId, examId } });
  return question !== null;
}

practicalTestCasesRouter.get("/", async (req: Request<{ examId: string }>, res) => {
  const { examId } = req.params;
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
  });
  if (!exam || exam.type !== "PRACTICAL") {
    res.status(404).json({ error: "Practical exam not found" });
    return;
  }
  const tests = await prisma.practicalTestCase.findMany({
    where: { examId },
    orderBy: { sortOrder: "asc" },
  });
  res.json(tests);
});

practicalTestCasesRouter.post("/", writeOnly, async (req: AuthedAdminRequest, res) => {
  const data = parseTestBody(req.body);
  if (!data) {
    res.status(400).json({ error: "Invalid test case" });
    return;
  }
  const exam = await prisma.exam.findUnique({ where: { id: req.params.examId } });
  if (!exam || exam.type !== "PRACTICAL") {
    res.status(404).json({ error: "Practical exam not found" });
    return;
  }
  // Adding a test case changes what every assigned student is graded
  // against — once any student has been assigned this exam, its test
  // cases must stay exactly as they were. See examImmutability.ts.
  if (await examHasAnyAssignment(exam.id)) {
    res.status(409).json({
      error: "Cannot add a test case: this exam already has at least one student assignment. Archive it and create a new exam instead.",
    });
    return;
  }
  if (!(await validateQuestionBelongsToExam(data.questionId, exam.id))) {
    res.status(400).json({ error: "questionId does not belong to this exam" });
    return;
  }
  const count = await prisma.practicalTestCase.count({ where: { examId: exam.id } });
  const row = await prisma.practicalTestCase.create({
    data: { examId: exam.id, ...data, sortOrder: data.sortOrder || count },
  });
  await recordAuditLog({
    adminId: req.admin!.id,
    action: "PRACTICAL_TEST_CASE_CREATED",
    targetType: "PracticalTestCase",
    targetId: row.id,
  });
  res.status(201).json(row);
});

practicalTestCasesRouter.put("/:testId", writeOnly, async (req: AuthedAdminRequest, res) => {
  const data = parseTestBody(req.body);
  if (!data) {
    res.status(400).json({ error: "Invalid test case" });
    return;
  }
  const existing = await prisma.practicalTestCase.findUnique({ where: { id: req.params.testId } });
  if (!existing) {
    res.status(404).json({ error: "Test case not found" });
    return;
  }
  if (await examHasAnyAssignment(existing.examId)) {
    res.status(409).json({
      error: "Cannot edit this test case: its exam already has at least one student assignment. Archive it and create a new exam instead.",
    });
    return;
  }
  if (!(await validateQuestionBelongsToExam(data.questionId, existing.examId))) {
    res.status(400).json({ error: "questionId does not belong to this exam" });
    return;
  }
  try {
    const row = await prisma.practicalTestCase.update({
      where: { id: req.params.testId },
      data,
    });
    await recordAuditLog({
      adminId: req.admin!.id,
      action: "PRACTICAL_TEST_CASE_UPDATED",
      targetType: "PracticalTestCase",
      targetId: row.id,
    });
    res.json(row);
  } catch {
    res.status(404).json({ error: "Test case not found" });
  }
});

practicalTestCasesRouter.delete("/:testId", writeOnly, async (req: AuthedAdminRequest, res) => {
  const existing = await prisma.practicalTestCase.findUnique({ where: { id: req.params.testId } });
  if (!existing) {
    res.status(404).json({ error: "Test case not found" });
    return;
  }
  if (await examHasAnyAssignment(existing.examId)) {
    res.status(409).json({
      error: "Cannot delete this test case: its exam already has at least one student assignment. Archive it and create a new exam instead.",
    });
    return;
  }
  try {
    await prisma.practicalTestCase.delete({ where: { id: req.params.testId } });
    await recordAuditLog({
      adminId: req.admin!.id,
      action: "PRACTICAL_TEST_CASE_DELETED",
      targetType: "PracticalTestCase",
      targetId: req.params.testId,
    });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: "Test case not found" });
  }
});
