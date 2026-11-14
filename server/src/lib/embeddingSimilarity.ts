import { createHash } from "node:crypto";
import type { ExamType } from "@prisma/client";
import { prisma } from "../prisma.js";

/** Cheap exact/near-exact-duplicate short-circuit, checked before the more
 * expensive cosine-similarity comparison. Normalizes case and whitespace so
 * trivial reformatting doesn't dodge it. */
export function contentHash(text: string): string {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex");
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export type SimilarityMatch = { similarity: number; summary: string } | null;

/**
 * Finds the most similar prior question in the same (topic, questionType)
 * bucket, by exact contentHash match first (similarity 1.0, cheap), then by
 * cosine similarity against stored embeddings. Returns null when the
 * bucket is empty — a brand-new topic can never be rejected as a
 * duplicate of nothing.
 */
export async function findMostSimilar(
  topic: string,
  questionType: ExamType,
  hash: string,
  embedding: number[]
): Promise<SimilarityMatch> {
  const bucket = await prisma.generatedQuestionEmbedding.findMany({
    where: { topic, questionType },
  });
  if (bucket.length === 0) return null;

  const exactMatch = bucket.find((row) => row.contentHash === hash);
  if (exactMatch) return { similarity: 1, summary: exactMatch.summary };

  let best: SimilarityMatch = null;
  for (const row of bucket) {
    const vector = JSON.parse(row.embedding) as number[];
    const similarity = cosineSimilarity(embedding, vector);
    if (!best || similarity > best.similarity) {
      best = { similarity, summary: row.summary };
    }
  }
  return best;
}

/** The most recent N scenario summaries in a bucket, for negative-example
 * prompting — never the full raw prompt/completion. */
export async function recentSummaries(topic: string, questionType: ExamType, limit = 5): Promise<string[]> {
  const rows = await prisma.generatedQuestionEmbedding.findMany({
    where: { topic, questionType },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => r.summary);
}
