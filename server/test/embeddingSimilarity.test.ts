import { describe, it, expect } from "vitest";
import { ExamType } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { contentHash, findMostSimilar } from "../src/lib/embeddingSimilarity.js";

function uniqueTopic(base: string): string {
  return `${base}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("findMostSimilar — embeddingModel bucketing (cross-model compatibility fix)", () => {
  it("never compares against a row stored under a different embeddingModel, even with an identical vector", async () => {
    const topic = uniqueTopic("Flexbox");
    const sharedVector = [1, 0, 0];
    await prisma.generatedQuestionEmbedding.create({
      data: {
        questionType: ExamType.MCQ,
        topic,
        difficulty: "EASY",
        summary: "an old voyage-3 question",
        contentHash: contentHash("completely different text than the new one"),
        embedding: JSON.stringify(sharedVector),
        embeddingModel: "voyage-3",
      },
    });

    // Querying as voyage-4-lite must see an EMPTY bucket — the voyage-3
    // row exists for this topic/type, but under a different model, so it
    // must never be returned as a similarity match, identical vector or not.
    const match = await findMostSimilar(topic, ExamType.MCQ, contentHash("a totally new question"), sharedVector, "voyage-4-lite");
    expect(match).toBeNull();
  });

  it("still finds a real duplicate when the stored row IS under the current embeddingModel", async () => {
    const topic = uniqueTopic("CSS Grid");
    const text = "What property defines grid columns?";
    const hash = contentHash(text);
    const vector = [0, 1, 0];
    await prisma.generatedQuestionEmbedding.create({
      data: {
        questionType: ExamType.MCQ,
        topic,
        difficulty: "EASY",
        summary: "grid columns question",
        contentHash: hash,
        embedding: JSON.stringify(vector),
        embeddingModel: "voyage-4-lite",
      },
    });

    const match = await findMostSimilar(topic, ExamType.MCQ, hash, vector, "voyage-4-lite");
    expect(match).not.toBeNull();
    expect(match!.similarity).toBe(1);
  });

  it("keeps each embeddingModel's history fully independent within the same topic/type", async () => {
    const topic = uniqueTopic("Semantic HTML");
    const hash = contentHash("shared exact text, same hash regardless of model");
    await prisma.generatedQuestionEmbedding.create({
      data: {
        questionType: ExamType.PRACTICAL,
        topic,
        difficulty: "MEDIUM",
        summary: "old model row",
        contentHash: hash,
        embedding: JSON.stringify([1, 1, 0]),
        embeddingModel: "voyage-3",
      },
    });
    await prisma.generatedQuestionEmbedding.create({
      data: {
        questionType: ExamType.PRACTICAL,
        topic,
        difficulty: "MEDIUM",
        summary: "new model row",
        contentHash: hash,
        embedding: JSON.stringify([0, 1, 1]),
        embeddingModel: "voyage-4-lite",
      },
    });

    // Even though both rows share the exact same contentHash, a
    // voyage-4-lite lookup must only ever match the voyage-4-lite row.
    const match = await findMostSimilar(topic, ExamType.PRACTICAL, hash, [0, 1, 1], "voyage-4-lite");
    expect(match?.summary).toBe("new model row");
  });
});
