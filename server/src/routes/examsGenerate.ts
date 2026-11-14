import { AdminRole, ExamType } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../prisma.js";
import { requireRole } from "../middleware/requireRole.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";
import { getAiClient } from "../lib/aiClient.js";
import { generateExam, validateGenerationConfig, type GenerationConfig } from "../lib/questionGenerator.js";
import { tryAcquireGenerationLock, releaseGenerationLock } from "../lib/generationLock.js";

export const examsGenerateRouter = Router();
// Generation produces questions + hidden answer keys — same SUPER_ADMIN-only
// write gate as exams.ts and practicalTestCases.ts.
const writeOnly = requireRole(AdminRole.SUPER_ADMIN);

function parseGenerationBody(body: Record<string, unknown>): GenerationConfig | null {
  const { type, title, topics, count, difficulty, totalMarks, durationMinutes, cohortId, publicWeightPct } = body;
  if (type !== "MCQ" && type !== "PRACTICAL") return null;
  if (typeof title !== "string" || !title.trim()) return null;
  if (!Array.isArray(topics) || topics.some((t) => typeof t !== "string")) return null;
  const topicList = (topics as string[]).map((t) => t.trim()).filter(Boolean);
  if (typeof count !== "number") return null;
  if (!difficulty || typeof difficulty !== "object") return null;
  const { EASY, MEDIUM, HARD } = difficulty as Record<string, unknown>;
  if (typeof EASY !== "number" || typeof MEDIUM !== "number" || typeof HARD !== "number") return null;
  if (typeof totalMarks !== "number" || typeof durationMinutes !== "number") return null;
  const cohort = typeof cohortId === "string" && cohortId ? cohortId : null;
  const weight = typeof publicWeightPct === "number" ? publicWeightPct : undefined;

  return {
    type: type === "MCQ" ? ExamType.MCQ : ExamType.PRACTICAL,
    title: title.trim(),
    topics: topicList,
    count: Math.floor(count),
    difficulty: { EASY, MEDIUM, HARD },
    totalMarks: Math.floor(totalMarks),
    durationMinutes: Math.floor(durationMinutes),
    cohortId: cohort,
    publicWeightPct: weight,
  };
}

examsGenerateRouter.post("/", writeOnly, async (req: AuthedAdminRequest, res) => {
  const config = parseGenerationBody(req.body ?? {});
  if (!config) {
    res.status(400).json({ error: "Invalid generation config" });
    return;
  }
  const problems = validateGenerationConfig(config);
  if (problems.length > 0) {
    res.status(400).json({ error: problems.join("; ") });
    return;
  }
  // getAiClient() is the single source of truth for "is generation
  // available" (it already checks aiConfig.isConfigured internally) — not
  // duplicated here, so there's exactly one place this can drift.
  const aiClient = getAiClient();
  if (!aiClient) {
    res.status(503).json({ error: "AI generation is not configured (missing ANTHROPIC_API_KEY/VOYAGE_API_KEY)" });
    return;
  }

  const adminId = req.admin!.id;
  if (!tryAcquireGenerationLock(adminId)) {
    res.status(409).json({ error: "A generation job is already running for this admin" });
    return;
  }

  try {
    const outcome = await generateExam(config, adminId, aiClient);
    if (outcome.status === "COMPLETED") {
      const exam = await prisma.exam.findUnique({
        where: { id: outcome.examId },
        include: { questions: { orderBy: { sortOrder: "asc" } }, practicalTests: { orderBy: { sortOrder: "asc" } } },
      });
      // GeneratedQuestionEmbedding rows already carry topic/difficulty per
      // accepted question (linked to this exam) — reusing that existing
      // data to summarize coverage, not a second generation pass.
      const embeddingRows = await prisma.generatedQuestionEmbedding.findMany({
        where: { examId: outcome.examId },
        select: { topic: true, difficulty: true },
      });
      const topicCoverage: Record<string, number> = {};
      const difficultyDistribution: Record<string, number> = {};
      for (const row of embeddingRows) {
        topicCoverage[row.topic] = (topicCoverage[row.topic] ?? 0) + 1;
        difficultyDistribution[row.difficulty] = (difficultyDistribution[row.difficulty] ?? 0) + 1;
      }
      res.status(201).json({ jobId: outcome.jobId, exam, topicCoverage, difficultyDistribution });
      return;
    }
    if (outcome.status === "INSUFFICIENT_UNIQUENESS") {
      res.status(422).json({
        error: "Could not generate enough unique questions",
        jobId: outcome.jobId,
        unresolvedSlots: outcome.unresolvedSlots,
      });
      return;
    }
    res.status(500).json({ error: outcome.errorMessage, jobId: outcome.jobId });
  } finally {
    releaseGenerationLock(adminId);
  }
});

examsGenerateRouter.get("/jobs", async (req: AuthedAdminRequest, res) => {
  const jobs = await prisma.examGenerationJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(jobs);
});
