import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ENV_KEYS = [
  "NODE_ENV",
  "OTP_DELIVERY_MODE",
  "OTP_HASH_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const VALID_LIVE_CONFIG = {
  OTP_HASH_SECRET: "a-sufficiently-long-secret-value",
  RESEND_API_KEY: "re_1234567890abcdef",
  RESEND_FROM_EMAIL: "otp@zaio.io",
  TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
  TWILIO_AUTH_TOKEN: "b".repeat(32),
  TWILIO_PHONE_NUMBER: "+15551234567",
};

/** Re-imports otpConfig.ts fresh against the current process.env, since the
 * module computes `otpConfig` once at import time. */
async function freshOtpConfig() {
  const { vi } = await import("vitest");
  vi.resetModules();
  return import("../src/lib/otpConfig.js");
}

function applyEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) process.env[k] = v;
  }
}

describe("assertOtpConfigSafeToBoot — fail-closed, independent of NODE_ENV", () => {
  it("mock mode + short/dev hash secret: boots with only a warning, in any NODE_ENV", async () => {
    applyEnv({ NODE_ENV: "development", OTP_DELIVERY_MODE: "mock", OTP_HASH_SECRET: "short" });
    const { assertOtpConfigSafeToBoot } = await freshOtpConfig();
    expect(() => assertOtpConfigSafeToBoot()).not.toThrow();
  });

  it("production + mock mode: always refuses to boot", async () => {
    applyEnv({ NODE_ENV: "production", OTP_DELIVERY_MODE: "mock", ...VALID_LIVE_CONFIG });
    const { assertOtpConfigSafeToBoot } = await freshOtpConfig();
    expect(() => assertOtpConfigSafeToBoot()).toThrow(/mock OTP delivery/);
  });

  it("live mode + fully valid config + NODE_ENV=development: boots without throwing", async () => {
    applyEnv({ NODE_ENV: "development", OTP_DELIVERY_MODE: "live", ...VALID_LIVE_CONFIG });
    const { assertOtpConfigSafeToBoot } = await freshOtpConfig();
    expect(() => assertOtpConfigSafeToBoot()).not.toThrow();
  });

  it("live mode + fully valid config + NODE_ENV unset: boots without throwing", async () => {
    applyEnv({ OTP_DELIVERY_MODE: "live", ...VALID_LIVE_CONFIG });
    const { assertOtpConfigSafeToBoot } = await freshOtpConfig();
    expect(() => assertOtpConfigSafeToBoot()).not.toThrow();
  });

  it("live mode + ALL credentials missing + NODE_ENV=development: refuses to boot (no more dev-only warn-and-continue)", async () => {
    applyEnv({ NODE_ENV: "development", OTP_DELIVERY_MODE: "live", OTP_HASH_SECRET: VALID_LIVE_CONFIG.OTP_HASH_SECRET });
    const { assertOtpConfigSafeToBoot } = await freshOtpConfig();
    expect(() => assertOtpConfigSafeToBoot()).toThrow(/Refusing to start/);
  });

  it("live mode + NODE_ENV=test + missing credentials: still refuses (no environment is exempt)", async () => {
    applyEnv({ NODE_ENV: "test", OTP_DELIVERY_MODE: "live", OTP_HASH_SECRET: VALID_LIVE_CONFIG.OTP_HASH_SECRET });
    const { assertOtpConfigSafeToBoot } = await freshOtpConfig();
    expect(() => assertOtpConfigSafeToBoot()).toThrow(/Refusing to start/);
  });

  it("live mode + each credential individually missing: refuses to boot and names the missing one", async () => {
    for (const missingKey of ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"] as const) {
      const config = { ...VALID_LIVE_CONFIG, [missingKey]: "" };
      applyEnv({ NODE_ENV: "development", OTP_DELIVERY_MODE: "live", ...config });
      const { assertOtpConfigSafeToBoot } = await freshOtpConfig();
      expect(() => assertOtpConfigSafeToBoot()).toThrow(new RegExp(missingKey));
    }
  });

  it("live mode + malformed (not just missing) credentials: refuses to boot", async () => {
    const malformed = {
      ...VALID_LIVE_CONFIG,
      RESEND_FROM_EMAIL: "not-an-email",
      TWILIO_ACCOUNT_SID: "not-a-twilio-sid",
      TWILIO_PHONE_NUMBER: "0821110000", // missing + / not E.164
    };
    applyEnv({ NODE_ENV: "development", OTP_DELIVERY_MODE: "live", ...malformed });
    const { assertOtpConfigSafeToBoot } = await freshOtpConfig();
    expect(() => assertOtpConfigSafeToBoot()).toThrow(/not a valid email|does not look like a Twilio SID|not a valid E\.164/);
  });

  it("live mode + weak OTP_HASH_SECRET even with otherwise-valid provider config: refuses to boot", async () => {
    applyEnv({ NODE_ENV: "development", OTP_DELIVERY_MODE: "live", ...VALID_LIVE_CONFIG, OTP_HASH_SECRET: "short" });
    const { assertOtpConfigSafeToBoot } = await freshOtpConfig();
    expect(() => assertOtpConfigSafeToBoot()).toThrow(/OTP_HASH_SECRET/);
  });
});

describe("validateLiveProviderConfig — format validation, not just presence", () => {
  it("accepts a fully valid configuration with zero problems", async () => {
    applyEnv({ OTP_DELIVERY_MODE: "live", ...VALID_LIVE_CONFIG });
    const { validateLiveProviderConfig } = await freshOtpConfig();
    expect(validateLiveProviderConfig()).toEqual([]);
  });

  it("rejects a Twilio auth token that isn't 32 hex chars", async () => {
    applyEnv({ OTP_DELIVERY_MODE: "live", ...VALID_LIVE_CONFIG, TWILIO_AUTH_TOKEN: "not-hex-at-all" });
    const { validateLiveProviderConfig } = await freshOtpConfig();
    expect(validateLiveProviderConfig().some((p) => p.includes("TWILIO_AUTH_TOKEN"))).toBe(true);
  });
});
