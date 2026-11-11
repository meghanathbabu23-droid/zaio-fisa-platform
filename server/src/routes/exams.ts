import { AdminRole, ExamType } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../prisma.js";
import { requireRole } from "../middleware/requireRole.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";
import { recordAuditLog } from "../lib/auditLog.js";

export const examsRouter = Router();
// ADMIN can read exams (needed to pick one when creating assignments); only
// SUPER_ADMIN can create/edit/delete exams or their answer keys.
const writeOnly = requireRole(AdminRole.SUPER_ADMIN);

type QuestionInput = {
  prompt: string;
  options: string[];
  correctIndex: number;
};

function parseQuestions(raw: unknown): QuestionInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: QuestionInput[] = [];
  for (const q of raw) {
    if (!q || typeof q !== "object") return null;
    const { prompt, options, correctIndex } = q as Record<string, unknown>;
    if (typeof prompt !== "string" || !Array.isArray(options)) return null;
    if (typeof correctIndex !== "number" || !Number.isInteger(correctIndex)) return null;
    const opts = options.map((o) => (typeof o === "string" ? o.trim() : "")).filter(Boolean);
    if (opts.length < 2 || correctIndex < 0 || correctIndex >= opts.length) return null;
    if (!prompt.trim()) return null;
    out.push({ prompt: prompt.trim(), options: opts, correctIndex });
  }
  return out;
}

function parseExamBody(body: Record<string, unknown>, requireQuestions: boolean) {
  const { title, type, durationMinutes, instructions, cohortId, questions } = body;
  if (typeof title !== "string" || typeof durationMinutes !== "number") return null;
  if (!title.trim() || durationMinutes < 1) return null;
  const examType =
    type === "PRACTICAL" ? ExamType.PRACTICAL : type === "MCQ" ? ExamType.MCQ : ExamType.MCQ;
  const cohort =
    cohortId === undefined || cohortId === null || cohortId === ""
      ? null
      : typeof cohortId === "string"
        ? cohortId.trim()
        : null;
  const parsedQuestions = questions !== undefined ? parseQuestions(questions) : null;
  if (requireQuestions && !parsedQuestions) return null;
  return {
    title: title.trim(),
    type: examType,
    durationMinutes: Math.floor(durationMinutes),
    instructions: typeof instructions === "string" ? instructions.trim() : "",
    cohortId: cohort,
    questions: parsedQuestions,
  };
}

examsRouter.get("/", async (req, res) => {
  const activeParam = typeof req.query.active === "string" ? req.query.active : undefined;
  const exams = await prisma.exam.findMany({
    where: activeParam === "true" ? { isActive: true } : activeParam === "false" ? { isActive: false } : undefined,
    include: {
      cohort: true,
      _count: { select: { questions: true, assignments: true, practicalTests: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(exams);
});

examsRouter.get("/:id", async (req, res) => {
  const exam = await prisma.exam.findUnique({
    where: { id: req.params.id },
    include: {
      cohort: true,
      questions: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!exam) {
    res.status(404).json({ error: "Exam not found" });
    return;
  }
  res.json({
    ...exam,
    questions: exam.questions.map((q) => ({
      ...q,
      options: JSON.parse(q.options) as string[],
    })),
  });
});

examsRouter.post("/", writeOnly, async (req: AuthedAdminRequest, res) => {
  const isPractical = req.body?.type === "PRACTICAL";
  const data = parseExamBody(req.body, !isPractical);
  if (!data) {
    res.status(400).json({ error: "Invalid exam payload" });
    return;
  }
  if (data.type === ExamType.MCQ && !data.questions?.length) {
    res.status(400).json({ error: "MCQ exams require questions" });
    return;
  }
  try {
    const exam = await prisma.exam.create({
      data: {
        title: data.title,
        type: data.type,
        durationMinutes: data.durationMinutes,
        instructions: data.instructions,
        cohortId: data.cohortId,
        ...(data.type === ExamType.MCQ && data.questions
          ? {
              questions: {
                create: data.questions.map((q, i) => ({
                  prompt: q.prompt,
                  options: JSON.stringify(q.options),
                  correctIndex: q.correctIndex,
                  sortOrder: i,
                })),
              },
            }
          : {}),
      },
      include: { questions: true, cohort: true },
    });
    await recordAuditLog({ adminId: req.admin!.id, action: "EXAM_CREATED", targetType: "Exam", targetId: exam.id });
    res.status(201).json(exam);
  } catch {
    res.status(400).json({ error: "Could not create exam" });
  }
});

examsRouter.put("/:id", writeOnly, async (req: AuthedAdminRequest, res) => {
  const data = parseExamBody(req.body, false);
  if (!data) {
    res.status(400).json({ error: "Invalid exam payload" });
    return;
  }
  try {
    const exam = await prisma.$transaction(async (tx) => {
      if (data.questions) {
        await tx.mcqQuestion.deleteMany({ where: { examId: req.params.id } });
        await tx.mcqQuestion.createMany({
          data: data.questions.map((q, i) => ({
            examId: req.params.id,
            prompt: q.prompt,
            options: JSON.stringify(q.options),
            correctIndex: q.correctIndex,
            sortOrder: i,
          })),
        });
      }
      return tx.exam.update({
        where: { id: req.params.id },
        data: {
          title: data.title,
          type: data.type,
          durationMinutes: data.durationMinutes,
          instructions: data.instructions,
          cohortId: data.cohortId,
        },
        include: { questions: { orderBy: { sortOrder: "asc" } }, cohort: true },
      });
    });
    await recordAuditLog({ adminId: req.admin!.id, action: "EXAM_UPDATED", targetType: "Exam", targetId: exam.id });
    res.json(exam);
  } catch {
    res.status(404).json({ error: "Exam not found" });
  }
});

/**
 * Toggles whether this exam appears in the active exam-assignment picker.
 * Never deletes the exam, its questions/test cases, or any existing
 * assignment/submission/result tied to it — those all remain exactly as
 * they were, for students who already have it and for historical records.
 */
examsRouter.put("/:id/active", writeOnly, async (req: AuthedAdminRequest, res) => {
  const { isActive } = req.body as Record<string, unknown>;
  if (typeof isActive !== "boolean") {
    res.status(400).json({ error: "'isActive' must be a boolean" });
    return;
  }
  try {
    const exam = await prisma.exam.update({ where: { id: req.params.id }, data: { isActive } });
    await recordAuditLog({
      adminId: req.admin!.id,
      action: "EXAM_ACTIVE_CHANGED",
      targetType: "Exam",
      targetId: exam.id,
      detail: `isActive=${exam.isActive}`,
    });
    res.json({ id: exam.id, isActive: exam.isActive });
  } catch {
    res.status(404).json({ error: "Exam not found" });
  }
});

examsRouter.delete("/:id", writeOnly, async (req: AuthedAdminRequest, res) => {
  try {
    await prisma.exam.delete({ where: { id: req.params.id } });
    await recordAuditLog({ adminId: req.admin!.id, action: "EXAM_DELETED", targetType: "Exam", targetId: req.params.id });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: "Exam not found" });
  }
});
