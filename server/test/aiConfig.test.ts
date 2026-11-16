import { afterEach, describe, expect, it, vi } from "vitest";

describe("aiConfig provider selection and isConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadAiConfig() {
    return import("../src/lib/aiConfig.js");
  }

  it("defaults to gemini when AI_LLM_PROVIDER is unset", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("VOYAGE_API_KEY", "");
    const { aiConfig } = await loadAiConfig();
    expect(aiConfig.llmProvider).toBe("gemini");
    expect(aiConfig.activeLlmModel).toBe(aiConfig.gemini.model);
    expect(aiConfig.isConfigured).toBe(false);
  });

  it("gemini provider requires GEMINI_API_KEY and VOYAGE_API_KEY", async () => {
    vi.stubEnv("AI_LLM_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "a".repeat(32));
    vi.stubEnv("VOYAGE_API_KEY", "b".repeat(32));
    vi.stubEnv("OPENAI_API_KEY", "");
    const { aiConfig } = await loadAiConfig();
    expect(aiConfig.isConfigured).toBe(true);
    expect(aiConfig.activeLlmModel).toBe("gemini-3.1-flash-lite");
  });

  it("openai provider requires only OPENAI_API_KEY; Voyage is not required", async () => {
    vi.stubEnv("AI_LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "c".repeat(32));
    vi.stubEnv("VOYAGE_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "e".repeat(32));
    const { aiConfig } = await loadAiConfig();
    expect(aiConfig.llmProvider).toBe("openai");
    expect(aiConfig.isConfigured).toBe(true);
    expect(aiConfig.activeLlmModel).toBe("gpt-4.1-mini");
    expect(aiConfig.activeEmbeddingModel).toBe("text-embedding-3-small");
  });

  it("openai provider stays unconfigured when OPENAI_API_KEY is missing", async () => {
    vi.stubEnv("AI_LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("VOYAGE_API_KEY", "d".repeat(32));
    const { aiConfig } = await loadAiConfig();
    expect(aiConfig.isConfigured).toBe(false);
  });

  it("gemini provider uses voyage model for activeEmbeddingModel", async () => {
    vi.stubEnv("AI_LLM_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "a".repeat(32));
    vi.stubEnv("VOYAGE_API_KEY", "b".repeat(32));
    const { aiConfig } = await loadAiConfig();
    expect(aiConfig.activeEmbeddingModel).toBe("voyage-4-lite");
  });

  it("validateAiConfig rejects an unknown AI_LLM_PROVIDER", async () => {
    vi.stubEnv("AI_LLM_PROVIDER", "anthropic");
    const { validateAiConfig } = await loadAiConfig();
    expect(validateAiConfig()).toContain('AI_LLM_PROVIDER must be "gemini" or "openai"');
  });
});