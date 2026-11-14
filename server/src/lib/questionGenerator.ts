import { ExamType, PracticalTestKind } from "@prisma/client";
import { prisma } from "../prisma.js";
import { aiConfig } from "./aiConfig.js";
import type { AiClient, Difficulty, GeneratedTestCase } from "./aiClient.js";
import { contentHash, findMostSimilar, recentSummaries } from "./embeddingSimilarity.js";
import { autoDistributeMarks } from "./mcqMarks.js";
import { recordAuditLog } from "./auditLog.js";

export type DifficultySplit = { EASY: number; MEDIUM: number; HARD: number };

export type GenerationConfig = {
  type: ExamType;
  title: string;
  topics: string[];
  count: number;
  difficulty: DifficultySplit;
  totalMarks: number;
  durationMinutes: number;
  cohortId: string | null;
  /** Coding only — fraction (0-1) of each challenge's weight given to
   * public sample test cases. Defaults to aiConfig.defaultPublicWeightPct. */
  publicWeightPct?: number;
};

export type GenerationOutcome =
  | { status: "COMPLETED"; jobId: string; examId: string }
  | { status: "FAILED"; jobId: string; errorMessage: string }
  | { status: "INSUFFICIENT_UNIQUENESS"; jobId: string; unresolvedSlots: { topic: string; difficulty: Difficulty }[] };

export function validateGenerationConfig(config: GenerationConfig): string[] {
  const problems: string[] = [];
  if (config.topics.length === 0) problems.push("At least one topic is required");
  if (!Number.isInteger(config.count) || config.count < 1) problems.push("count must be a positive integer");
  if (!Number.isInteger(config.totalMarks) || config.totalMarks < 1) problems.push("totalMarks must be a positive integer");
  if (!Number.isInteger(config.durationMinutes) || config.durationMinutes < 1) problems.push("durationMinutes must be a positive integer");
  const sum = config.difficulty.EASY + config.difficulty.MEDIUM + config.difficulty.HARD;
  if (sum !== 100) problems.push(`Difficulty percentages must sum to 100 (got ${sum})`);
  if (config.publicWeightPct !== undefined && (config.publicWeightPct < 0 || config.publicWeightPct > 1)) {
    problems.push("publicWeightPct must be between 0 and 1");
  }
  return problems;
}

/** Expands a percentage split into per-difficulty slot counts using the
 * same floor+remainder distribution as mcqMarks.ts, then assigns each slot
 * a topic by cycling through the configured topics round-robin — this is
 * what gives topic/difficulty coverage across the generated set. */
function buildSlots(config: GenerationConfig): { topic: string; difficulty: Difficulty }[] {
  const order: Difficulty[] = ["EASY", "MEDIUM", "HARD"];
  const counts = order.map((d) => Math.round((config.difficulty[d] / 100) * config.count));
  // Rounding can drift the total by a question or two — correct it against
  // the largest bucket so the sum always matches config.count exactly.
  let drift = config.count - counts.reduce((s, c) => s + c, 0);
  while (drift !== 0) {
    const idx = counts.indexOf(Math.max(...counts));
    counts[idx] += drift > 0 ? 1 : -1;
    drift += drift > 0 ? -1 : 1;
  }
  const slots: { topic: string; difficulty: Difficulty }[] = [];
  order.forEach((difficulty, i) => {
    for (let n = 0; n < counts[i]; n++) slots.push({ topic: "", difficulty });
  });
  slots.forEach((slot, i) => {
    slot.topic = config.topics[i % config.topics.length];
  });
  return slots;
}

type AcceptedMcq = { topic: string; difficulty: Difficulty; prompt: string; options: string[]; correctIndex: number; summary: string; hash: string; embedding: number[]; embeddingId: string };
type AcceptedChallenge = {
  topic: string;
  difficulty: Difficulty;
  embeddingId: string;
  businessContext: string;
  functionalRequirements: string[];
  uiRequirements: string[];
  technicalConstraints: string[];
  deliverables: string[];
  acceptanceCriteria: string[];
  summary: string;
  publicTestCases: GeneratedTestCase[];
  hiddenTestCases: GeneratedTestCase[];
  hash: string;
  embedding: number[];
};

type SlotStat = { topic: string; difficulty: Difficulty; attempts: number; accepted: boolean; maxSimilaritySeen: number };

async function resolveMcqSlot(
  aiClient: AiClient,
  slot: { topic: string; difficulty: Difficulty }
): Promise<{ accepted: AcceptedMcq | null; stat: SlotStat }> {
  const stat: SlotStat = { topic: slot.topic, difficulty: slot.difficulty, attempts: 0, accepted: false, maxSimilaritySeen: 0 };
  for (let attempt = 0; attempt < aiConfig.maxRegenAttempts; attempt++) {
    stat.attempts++;
    const avoidSummaries = await recentSummaries(slot.topic, ExamType.MCQ);
    const generated = await aiClient.generateMcq({ topic: slot.topic, difficulty: slot.difficulty, avoidSummaries });
    const text = `${generated.prompt} ${generated.options.join(" ")}`;
    const hash = contentHash(text);
    const embedding = await aiClient.embed(text);
    const match = await findMostSimilar(slot.topic, ExamType.MCQ, hash, embedding);
    const similarity = match?.similarity ?? 0;
    stat.maxSimilaritySeen = Math.max(stat.maxSimilaritySeen, similarity);
    if (match && similarity >= aiConfig.similarityThreshold) continue;
    stat.accepted = true;
    // Persisted immediately (examId null for now, back-filled once the
    // exam is created) — not batched until the end — so a later slot in
    // THIS SAME generation run correctly sees this one as prior history
    // when checking its own similarity, not just future generation runs.
    const row = await prisma.generatedQuestionEmbedding.create({
      data: {
        questionType: ExamType.MCQ,
        topic: slot.topic,
        difficulty: slot.difficulty,
        summary: generated.summary,
        contentHash: hash,
        embedding: JSON.stringify(embedding),
        embeddingModel: "voyage-3",
      },
    });
    return { accepted: { ...slot, ...generated, hash, embedding, embeddingId: row.id }, stat };
  }
  return { accepted: null, stat };
}

async function resolveChallengeSlot(
  aiClient: AiClient,
  slot: { topic: string; difficulty: Difficulty }
): Promise<{ accepted: AcceptedChallenge | null; stat: SlotStat }> {
  const stat: SlotStat = { topic: slot.topic, difficulty: slot.difficulty, attempts: 0, accepted: false, maxSimilaritySeen: 0 };
  for (let attempt = 0; attempt < aiConfig.maxRegenAttempts; attempt++) {
    stat.attempts++;
    const avoidSummaries = await recentSummaries(slot.topic, ExamType.PRACTICAL);
    const generated = await aiClient.generateCodingQuestion({ topic: slot.topic, difficulty: slot.difficulty, avoidSummaries });
    const text = `${generated.businessContext} ${generated.functionalRequirements.join(" ")} ${generated.summary}`;
    const hash = contentHash(text);
    const embedding = await aiClient.embed(text);
    const match = await findMostSimilar(slot.topic, ExamType.PRACTICAL, hash, embedding);
    const similarity = match?.similarity ?? 0;
    stat.maxSimilaritySeen = Math.max(stat.maxSimilaritySeen, similarity);
    if (match && similarity >= aiConfig.similarityThreshold) continue;
    stat.accepted = true;
    const row = await prisma.generatedQuestionEmbedding.create({
      data: {
        questionType: ExamType.PRACTICAL,
        topic: slot.topic,
        difficulty: slot.difficulty,
        summary: generated.summary,
        contentHash: hash,
        embedding: JSON.stringify(embedding),
        embeddingModel: "voyage-3",
      },
    });
    return { accepted: { ...slot, ...generated, hash, embedding, embeddingId: row.id }, stat };
  }
  return { accepted: null, stat };
}

/** Splits a group's total weight evenly across its test cases, remainder
 * added to the first — same rounding technique as autoDistributeMarks. */
function splitWeight(count: number, total: number): number[] {
  return autoDistributeMarks(count, total);
}

function buildPracticalInstructions(config: GenerationConfig, challenges: AcceptedChallenge[], marks: number[]): string {
  const header =
    `${config.title} — AI-generated practical assessment.\n` +
    `Total Marks: ${config.totalMarks} | Duration: ${config.durationMinutes} minutes.\n\n`;
  const body = challenges
    .map((c, i) => {
      const lines = [
        `CHALLENGE ${i + 1} (${marks[i]} marks, ${c.difficulty} — ${c.topic}): ${c.businessContext}`,
        `Functional requirements:\n${c.functionalRequirements.map((r) => `- ${r}`).join("\n")}`,
        `UI requirements:\n${c.uiRequirements.map((r) => `- ${r}`).join("\n")}`,
        `Technical constraints:\n${c.technicalConstraints.map((r) => `- ${r}`).join("\n")}`,
        `Deliverables:\n${c.deliverables.map((r) => `- ${r}`).join("\n")}`,
        `Acceptance criteria:\n${c.acceptanceCriteria.map((r) => `- ${r}`).join("\n")}`,
      ];
      return lines.join("\n");
    })
    .join("\n\n");
  return header + body;
}

/**
 * Runs one full generation job end to end: creates the ExamGenerationJob
 * row immediately (the idempotency anchor), resolves every requested
 * question/challenge slot against the AI client with duplicate rejection
 * and regeneration, and only persists an Exam if every slot was resolved.
 * Never throws for an ordinary generation failure — returns a FAILED or
 * INSUFFICIENT_UNIQUENESS outcome instead; only a genuine bug should throw.
 */
export async function generateExam(config: GenerationConfig, adminId: string, aiClient: AiClient): Promise<GenerationOutcome> {
  const job = await prisma.examGenerationJob.create({
    data: {
      requestedByAdminId: adminId,
      configJson: JSON.stringify(config),
      status: "PENDING",
      aiModel: "claude-sonnet-4-5",
      embeddingModel: "voyage-3",
    },
  });

  const slots = buildSlots(config);
  const stats: SlotStat[] = [];

  try {
    if (config.type === ExamType.MCQ) {
      const accepted: AcceptedMcq[] = [];
      const unresolved: { topic: string; difficulty: Difficulty }[] = [];
      for (const slot of slots) {
        const { accepted: a, stat } = await resolveMcqSlot(aiClient, slot);
        stats.push(stat);
        if (a) accepted.push(a);
        else unresolved.push(slot);
      }

      if (unresolved.length > 0) {
        await prisma.examGenerationJob.update({
          where: { id: job.id },
          data: {
            status: "INSUFFICIENT_UNIQUENESS",
            duplicateStatsJson: JSON.stringify(stats),
            completedAt: new Date(),
          },
        });
        return { status: "INSUFFICIENT_UNIQUENESS", jobId: job.id, unresolvedSlots: unresolved };
      }

      const marks = autoDistributeMarks(accepted.length, config.totalMarks);
      const exam = await prisma.$transaction(async (tx) => {
        const created = await tx.exam.create({
          data: {
            title: config.title,
            type: ExamType.MCQ,
            durationMinutes: config.durationMinutes,
            instructions: `${config.title} — AI-generated assessment.\nTotal Marks: ${config.totalMarks} | Duration: ${config.durationMinutes} minutes.`,
            cohortId: config.cohortId,
            totalMarks: config.totalMarks,
            // Generated exams start inactive (not assignable) so an admin
            // must review the questions and explicitly activate it — same
            // existing isActive/activate mechanism as manually-created
            // exams, not a new review/draft state.
            isActive: false,
            questions: {
              create: accepted.map((q, i) => ({
                prompt: q.prompt,
                options: JSON.stringify(q.options),
                correctIndex: q.correctIndex,
                marks: marks[i],
                sortOrder: i,
              })),
            },
          },
        });
        // Embedding rows already exist (created at acceptance time, see
        // resolveMcqSlot) — just back-fill examId now that it's known.
        await tx.generatedQuestionEmbedding.updateMany({
          where: { id: { in: accepted.map((q) => q.embeddingId) } },
          data: { examId: created.id },
        });
        return created;
      });

      await prisma.examGenerationJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", resultExamId: exam.id, duplicateStatsJson: JSON.stringify(stats), completedAt: new Date() },
      });
      await recordAuditLog({
        adminId,
        action: "EXAM_AI_GENERATED",
        targetType: "Exam",
        targetId: exam.id,
        detail: `model=claude-sonnet-4-5, mcq=${accepted.length}, topics=${config.topics.join(",")}`,
      });
      return { status: "COMPLETED", jobId: job.id, examId: exam.id };
    }

    // PRACTICAL — each slot is one "challenge" contributing text to the
    // exam's instructions and test cases to its single shared workspace,
    // matching the real FISA seed data's multi-challenge-in-one-exam shape.
    const accepted: AcceptedChallenge[] = [];
    const unresolved: { topic: string; difficulty: Difficulty }[] = [];
    for (const slot of slots) {
      const { accepted: a, stat } = await resolveChallengeSlot(aiClient, slot);
      stats.push(stat);
      if (a) accepted.push(a);
      else unresolved.push(slot);
    }

    if (unresolved.length > 0) {
      await prisma.examGenerationJob.update({
        where: { id: job.id },
        data: { status: "INSUFFICIENT_UNIQUENESS", duplicateStatsJson: JSON.stringify(stats), completedAt: new Date() },
      });
      return { status: "INSUFFICIENT_UNIQUENESS", jobId: job.id, unresolvedSlots: unresolved };
    }

    const publicWeightPct = config.publicWeightPct ?? aiConfig.defaultPublicWeightPct;
    const challengeMarks = autoDistributeMarks(accepted.length, config.totalMarks);
    const instructions = buildPracticalInstructions(config, accepted, challengeMarks);

    const testCaseCreates: {
      label: string;
      kind: PracticalTestKind;
      targetFile: string | null;
      expression: string;
      points: number;
      sortOrder: number;
      isHidden: boolean;
    }[] = [];
    let sortOrder = 0;
    accepted.forEach((challenge, i) => {
      const publicTotal = Math.round(challengeMarks[i] * publicWeightPct);
      const hiddenTotal = challengeMarks[i] - publicTotal;
      const publicWeights = splitWeight(challenge.publicTestCases.length, publicTotal);
      const hiddenWeights = splitWeight(challenge.hiddenTestCases.length, hiddenTotal);
      challenge.publicTestCases.forEach((tc, j) => {
        testCaseCreates.push({ ...tc, points: Math.max(1, publicWeights[j] ?? 0), sortOrder: sortOrder++, isHidden: false });
      });
      challenge.hiddenTestCases.forEach((tc, j) => {
        testCaseCreates.push({ ...tc, points: Math.max(1, hiddenWeights[j] ?? 0), sortOrder: sortOrder++, isHidden: true });
      });
    });

    const exam = await prisma.$transaction(async (tx) => {
      const created = await tx.exam.create({
        data: {
          title: config.title,
          type: ExamType.PRACTICAL,
          durationMinutes: config.durationMinutes,
          instructions,
          cohortId: config.cohortId,
          totalMarks: config.totalMarks,
          isActive: false,
          practicalTests: { create: testCaseCreates },
        },
      });
      await tx.generatedQuestionEmbedding.updateMany({
        where: { id: { in: accepted.map((c) => c.embeddingId) } },
        data: { examId: created.id },
      });
      return created;
    });

    await prisma.examGenerationJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", resultExamId: exam.id, duplicateStatsJson: JSON.stringify(stats), completedAt: new Date() },
    });
    await recordAuditLog({
      adminId,
      action: "EXAM_AI_GENERATED",
      targetType: "Exam",
      targetId: exam.id,
      detail: `model=claude-sonnet-4-5, challenges=${accepted.length}, topics=${config.topics.join(",")}`,
    });
    return { status: "COMPLETED", jobId: job.id, examId: exam.id };
  } catch (e) {
    // Never persist or return the raw error (could echo provider response
    // internals) — a short categorized message only, full detail
    // console-logged server-side for debugging.
    // eslint-disable-next-line no-console
    console.error("[questionGenerator] generation failed:", e instanceof Error ? e.message : e);
    const errorMessage = "Generation failed due to an internal or AI-provider error.";
    await prisma.examGenerationJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage, duplicateStatsJson: JSON.stringify(stats), completedAt: new Date() },
    });
    return { status: "FAILED", jobId: job.id, errorMessage };
  }
}
