import { describe, it, expect, afterEach } from "vitest";
import { otpConfig } from "../src/lib/otpConfig.js";
import { aiConfig } from "../src/lib/aiConfig.js";
import { setAiClientOverrideForTests } from "../src/lib/aiClient.js";
import { resetGenerationLockStateForTests } from "../src/lib/generationLock.js";

/**
 * Regression guard for a real bug: @prisma/client auto-loads server/.env
 * as a side effect the first time it's imported (dotenv-style — fills in
 * any var not already set, never overrides one that is). Any
 * provider-related var not explicitly forced in vitest.config.ts's test.env
 * block is therefore at the mercy of whichever test file happens to import
 * prisma.js first, which can leak a real, developer-machine-specific .env
 * value (e.g. EMAIL_PROVIDER left on "gmail_smtp" after a demo) into these
 * module-level config singletons for the ENTIRE test run, regardless of
 * which test file this one runs alongside or in what order.
 *
 * If this test ever fails, the fix is almost always to force the relevant
 * var in vitest.config.ts's test.env block — not to change otpConfig.ts,
 * aiConfig.ts, or any other application source file.
 */
describe("test environment isolation — provider config never leaks from the real server/.env", () => {
  it("otpConfig reflects the forced test default, not whatever EMAIL_PROVIDER happens to be in server/.env", () => {
    expect(otpConfig.emailProviderName).toBe("resend");
    expect(otpConfig.deliveryMode).toBe("mock");
  });

  it("aiConfig has no real API keys reachable from the test process, regardless of what's in server/.env", () => {
    expect(aiConfig.llmProvider).toBe("gemini");
    expect(aiConfig.gemini.apiKey).toBe("");
    expect(aiConfig.openai.apiKey).toBe("");
    expect(aiConfig.voyage.apiKey).toBe("");
    expect(aiConfig.isConfigured).toBe(false);
  });
});

describe("test-only escape hatches refuse outright under NODE_ENV=production", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("setAiClientOverrideForTests throws instead of silently taking effect", () => {
    process.env.NODE_ENV = "production";
    expect(() => setAiClientOverrideForTests(null)).toThrow(/must never be called/);
  });

  it("resetGenerationLockStateForTests throws instead of silently taking effect", () => {
    process.env.NODE_ENV = "production";
    expect(() => resetGenerationLockStateForTests()).toThrow(/must never be called/);
  });
});
