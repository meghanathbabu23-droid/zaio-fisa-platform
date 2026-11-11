import { AdminRole, PracticalTestKind } from "@prisma/client";
import { type Request, Router } from "express";
import { prisma } from "../prisma.js";
import { requireRole } from "../middleware/requireRole.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";
import { recordAuditLog } from "../lib/auditLog.js";

export const practicalTestCasesRouter = Router({ mergeParams: true });
// Practical test cases are effectively exam answer keys — ADMIN can read
// them (needed for assignment/results context) but only SUPER_ADMIN may
// create, edit, or delete them.
const writeOnly = requireRole(AdminRole.SUPER_ADMIN);

const KINDS = new Set<string>(Object.values(PracticalTestKind));

function parseTestBody(body: Record<string, unknown>) {
  const { label, kind, targetFile, expression, points, sortOrder } = body;
  if (typeof label !== "string" || typeof kind !== "string" || typeof expression !== "string") {
    return null;
  }
  if (!label.trim() || !expression.trim() || !KINDS.has(kind)) return null;
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
  };
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
