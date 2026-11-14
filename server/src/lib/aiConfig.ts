/**
 * Single source of truth for AI question-generation environment config.
 * Read once at module load, validated once — nothing else in the app should
 * read ANTHROPIC_API_KEY/VOYAGE_API_KEY from process.env directly.
 *
 * Unlike otpConfig, missing keys here do NOT block server boot: AI
 * generation is an optional, independently-gated capability layered on top
 * of an exam platform that works fully without it. assertAiConfigSafeToBoot
 * only rejects a malformed-but-present key; a route that needs generation
 * checks aiConfig.isConfigured itself and returns 503 if it's false.
 */

function readKey(name: string): string {
  return (process.env[name] ?? "").trim();
}

export const aiConfig = {
  anthropic: {
    apiKey: readKey("ANTHROPIC_API_KEY"),
  },
  voyage: {
    apiKey: readKey("VOYAGE_API_KEY"),
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

  get isConfigured(): boolean {
    return Boolean(this.anthropic.apiKey && this.voyage.apiKey);
  },
};

const ANTHROPIC_KEY_SHAPE = /^sk-ant-/;

/** Returns human-readable problems — never values — for a key that is
 * PRESENT but malformed. An absent key is never a "problem" here. */
export function validateAiConfig(): string[] {
  const problems: string[] = [];
  if (aiConfig.anthropic.apiKey && !ANTHROPIC_KEY_SHAPE.test(aiConfig.anthropic.apiKey)) {
    problems.push("ANTHROPIC_API_KEY is set but doesn't look like a valid Anthropic API key (expected sk-ant- prefix)");
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
 * until both keys are present and well-formed; the rest of the platform
 * boots and runs completely independently of this. */
export function assertAiConfigSafeToBoot(): void {
  const problems = validateAiConfig();
  if (problems.length > 0) {
    throw new Error(`Refusing to start: invalid AI config — ${problems.join("; ")}`);
  }
}
