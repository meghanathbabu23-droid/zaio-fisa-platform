/**
 * Single source of truth for AI question-generation environment config.
 * Read once at module load, validated once — nothing else in the app should
 * read GEMINI_API_KEY/VOYAGE_API_KEY/OPENAI_API_KEY from process.env directly.
 *
 * Unlike otpConfig, missing keys here do NOT block server boot: AI
 * generation is an optional, independently-gated capability layered on top
 * of an exam platform that works fully without it. assertAiConfigSafeToBoot
 * only rejects a malformed-but-present key; a route that needs generation
 * checks aiConfig.isConfigured itself and returns 503 if it's false.
 *
 * LLM: Google Gemini (default, gemini-3.1-flash-lite) or OpenAI
 * (gpt-4.1-mini by default) for MCQ/coding question generation — selected
 * by AI_LLM_PROVIDER. Embeddings for duplicate detection follow the same
 * provider: Voyage (voyage-4-lite, 1024-d) when gemini, OpenAI
 * (text-embedding-3-small, 1024-d) when openai. Buckets are keyed by
 * embeddingModel string so historical Voyage rows never compare against
 * OpenAI vectors. OpenAI mode needs only OPENAI_API_KEY; Gemini mode needs
 * GEMINI_API_KEY plus VOYAGE_API_KEY.
 */

function readKey(name: string): string {
  return (process.env[name] ?? "").trim();
}

export type LlmProvider = "gemini" | "openai";

function readLlmProvider(): LlmProvider {
  const raw = (process.env.AI_LLM_PROVIDER ?? "gemini").trim().toLowerCase();
  return raw === "openai" ? "openai" : "gemini";
}

export const aiConfig = {
  llmProvider: readLlmProvider(),
  gemini: {
    apiKey: readKey("GEMINI_API_KEY"),
    model: process.env.AI_GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite",
  },
  openai: {
    apiKey: readKey("OPENAI_API_KEY"),
    model: process.env.AI_OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    embeddingModel: process.env.AI_OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    // Explicit 1024-d matches the voyage-4-lite bucket dimension so cosine
    // math and stored JSON shape stay consistent; OpenAI rows still land
    // under embeddingModel "text-embedding-3-small", never voyage-*.
    embeddingDimensions: Number(process.env.AI_OPENAI_EMBEDDING_DIMENSIONS ?? 1024),
  },
  voyage: {
    apiKey: readKey("VOYAGE_API_KEY"),
    model: process.env.AI_VOYAGE_MODEL?.trim() || "voyage-4-lite",
    // Explicit, not left to whatever Voyage currently defaults to for a
    // given model — this is the one value that MUST stay consistent across
    // every stored embedding for cosine similarity to mean anything.
    // 1024 matches both voyage-3 (the prior model) and voyage-4-lite's own
    // default, confirmed against Voyage's current docs before this model
    // switch; embeddingSimilarity.ts additionally buckets by embeddingModel
    // so a future model/dimension change can never silently compare
    // incomparable vectors even if this ever drifts.
    outputDimension: 1024,
  },
  // Cosine-similarity threshold above which a generated question is treated
  // as a near-duplicate and rejected/regenerated. Configurable so it can be
  // tuned without a code change; 0.88 is the plan's starting default.
  similarityThreshold: Number(process.env.AI_SIMILARITY_THRESHOLD ?? 0.88),
  // Regeneration attempts per question slot before giving up on that slot.
  maxRegenAttempts: Number(process.env.AI_MAX_REGEN_ATTEMPTS ?? 3),
  // Default fraction (0-1) of a coding question's weight given to PUBLIC
  // sample test cases; the rest goes to hidden evaluation cases.
  defaultPublicWeightPct: Number(process.env.AI_DEFAULT_PUBLIC_WEIGHT_PCT ?? 0.3),

  /** Model name persisted on ExamGenerationJob and audit detail lines. */
  get activeLlmModel(): string {
    return this.llmProvider === "openai" ? this.openai.model : this.gemini.model;
  },

  /** Stored on GeneratedQuestionEmbedding and passed to findMostSimilar. */
  get activeEmbeddingModel(): string {
    return this.llmProvider === "openai" ? this.openai.embeddingModel : this.voyage.model;
  },

  get isConfigured(): boolean {
    if (this.llmProvider === "openai") {
      return Boolean(this.openai.apiKey);
    }
    return Boolean(this.gemini.apiKey && this.voyage.apiKey);
  },
};

/** Returns human-readable problems — never values — for a key that is
 * PRESENT but malformed. An absent key is never a "problem" here.
 *
 * No prefix-shape check for GEMINI_API_KEY: Google's own key format has
 * changed at least once (legacy "AIza..." vs newer "AQ...." keys, per
 * Google's current developer-forum reports) — asserting a specific prefix
 * risks rejecting a genuinely valid key. Length is still a reasonable
 * floor, same approach already used for VOYAGE_API_KEY below. */
export function validateAiConfig(): string[] {
  const problems: string[] = [];
  const provider = (process.env.AI_LLM_PROVIDER ?? "gemini").trim().toLowerCase();
  if (provider && provider !== "gemini" && provider !== "openai") {
    problems.push('AI_LLM_PROVIDER must be "gemini" or "openai"');
  }
  if (aiConfig.gemini.apiKey && aiConfig.gemini.apiKey.length < 20) {
    problems.push("GEMINI_API_KEY is set but looks too short to be a real Gemini API key");
  }
  if (aiConfig.openai.apiKey && aiConfig.openai.apiKey.length < 20) {
    problems.push("OPENAI_API_KEY is set but looks too short to be a real OpenAI API key");
  }
  if (aiConfig.voyage.apiKey && aiConfig.voyage.apiKey.length < 20) {
    problems.push("VOYAGE_API_KEY is set but looks too short to be a real Voyage AI API key");
  }
  if (!Number.isFinite(aiConfig.similarityThreshold) || aiConfig.similarityThreshold <= 0 || aiConfig.similarityThreshold > 1) {
    problems.push("AI_SIMILARITY_THRESHOLD must be a number between 0 and 1");
  }
  if (!Number.isInteger(aiConfig.maxRegenAttempts) || aiConfig.maxRegenAttempts < 1) {
    problems.push("AI_MAX_REGEN_ATTEMPTS must be a positive integer");
  }
  return problems;
}

/** Only ever rejects a malformed-but-present key or an invalid tuning
 * value — never an absent key. AI generation stays off (routes return 503)
 * until the required keys for the active provider are present and
 * well-formed; the rest of the platform
 * boots and runs completely independently of this. */
export function assertAiConfigSafeToBoot(): void {
  const problems = validateAiConfig();
  if (problems.length > 0) {
    throw new Error(`Refusing to start: invalid AI config — ${problems.join("; ")}`);
  }
}