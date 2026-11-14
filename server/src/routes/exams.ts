import { AdminRole, ExamType } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../prisma.js";
import { requireRole } from "../middleware/requireRole.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";
import { recordAuditLog } from "../lib/auditLog.js";
import { validateMcqMarks } from "../lib/mcqMarks.js";
import { examHasAnyAssignment } from "../lib/examImmutability.js";

export const examsRouter = Router();
// ADMIN can read exams (needed to pick one when creating assignments); only
// SUPER_ADMIN can create/edit/delete exams or their answer keys.
const writeOnly = requireRole(AdminRole.SUPER_ADMIN);

type QuestionInput = {
  prompt: string;
  options: string[];
  correctIndex: number;
  marks: number;
};

function parseQuestions(raw: unknown): QuestionInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: QuestionInput[] = [];
  for (const q of raw) {
    if (!q || typeof q !== "object") return null;
    const { prompt, options, correctIndex, marks } = q as Record<string, unknown>;
    if (typeof prompt !== "string" || !Array.isArray(options)) return null;
    if (typeof correctIndex !== "number" || !Number.isInteger(correctIndex)) return null;
    if (typeof marks !== "number" || !Number.isInteger(marks) || marks < 0) return null;
    const opts = options.map((o) => (typeof o === "string" ? o.trim() : "")).filter(Boolean);
    if (opts.length < 2 || correctIndex < 0 || correctIndex >= opts.length) return null;
    if (!prompt.trim()) return null;
    out.push({ prompt: prompt.trim(), options: opts, correctIndex, marks });
  }
  return out;
}

type ParsedExam = {
  title: string;
  type: ExamType;
  durationMinutes: number;
  instructions: string;
  cohortId: string | null;
  questions: QuestionInput[] | null;
  totalMarks: number;
};

function parseExamBody(
  body: Record<string, unknown>,
  requireQuestions: boolean
): { ok: true; data: ParsedExam } | { ok: false; error: string } {
  const { title, type, durationMinutes, instructions, cohortId, questions, totalMarks } = body;
  if (typeof title !== "string" || typeof durationMinutes !== "number" || !title.trim() || durationMinutes < 1) {
    return { ok: false, error: "Invalid exam payload" };
  }
  if (typeof totalMarks !== "number" || !Number.isInteger(totalMarks) || totalMarks <= 0) {
    return { ok: false, error: "totalMarks must be a positive integer" };
  }
  const examType =
    type === "PRACTICAL" ? ExamType.PRACTICAL : type === "MCQ" ? ExamType.MCQ : ExamType.MCQ;
  const cohort =
    cohortId === undefined || cohortId === null || cohortId === ""
      ? null
      : typeof cohortId === "string"
        ? cohortId.trim()
        : null;
  const parsedQuestions = questions !== undefined ? parseQuestions(questions) : null;
  if (requireQuestions && !parsedQuestions) {
    return { ok: false, error: "Invalid exam payload" };
  }
  if (examType === ExamType.MCQ && parsedQuestions) {
    const problems = validateMcqMarks(parsedQuestions, totalMarks);
    if (problems.length > 0) return { ok: false, error: problems.join("; ") };
  }
  return {
    ok: true,
    data: {
      title: title.trim(),
      type: examType,
      durationMinutes: Math.floor(durationMinutes),
      instructions: typeof instructions === "string" ? instructions.trim() : "",
      cohortId: cohort,
      questions: parsedQuestions,
      totalMarks,
    },
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
  const parsed = parseExamBody(req.body, !isPractical);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const data = parsed.data;
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
        totalMarks: data.totalMarks,
        ...(data.type === ExamType.MCQ && data.questions
          ? {
              questions: {
                create: data.questions.map((q, i) => ({
                  prompt: q.prompt,
                  options: JSON.stringify(q.options),
                  correctIndex: q.correctIndex,
                  marks: q.marks,
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
  const parsed = parseExamBody(req.body, false);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const data = parsed.data;
  // Once any student has been assigned this exam, it must stay exactly as
  // it was — editing it here would mean different students sat different
  // exams, and historical marks would stop matching the exam's current
  // configuration. Archive it (isActive=false) and create a new exam for
  // changes instead.
  if (await examHasAnyAssignment(req.params.id)) {
    res.status(409).json({
      error: "Cannot edit this exam: it already has at least one student assignment. Archive it and create a new exam instead.",
    });
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
            marks: q.marks,
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
          totalMarks: data.totalMarks,
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
  if (isActive) {
    const existing = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: { questions: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Exam not found" });
      return;
    }
    if (existing.type === ExamType.MCQ) {
      const problems = validateMcqMarks(existing.questions, existing.totalMarks ?? 0);
      if (problems.length > 0) {
        res.status(400).json({ error: `Cannot activate: ${problems.join("; ")}` });
        return;
      }
    }
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
  // Exam.isActive's own doc comment already states this exam's history
  // should never disappear ("existing assignments or results" stay intact)
  // — but ExamAssignment.exam is onDelete: Cascade, so deleting an exam
  // with any assignment would silently wipe every student's attempt,
  // submission, score, assessor review, moderation record and evidence
  // tied to it. Enforce that documented invariant here: archive instead.
  if (await examHasAnyAssignment(req.params.id)) {
    res.status(409).json({
      error: "Cannot delete this exam: it has at least one student assignment. Archive it instead to preserve student history.",
    });
    return;
  }
  try {
    await prisma.exam.delete({ where: { id: req.params.id } });
    await recordAuditLog({ adminId: req.admin!.id, action: "EXAM_DELETED", targetType: "Exam", targetId: req.params.id });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: "Exam not found" });
  }
});
