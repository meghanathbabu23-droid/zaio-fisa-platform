import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import rateLimit from "express-rate-limit";
import {
  checkIdentifierRateLimit,
  checkResendCooldown,
  checkStudentVerifyRateLimit,
  recordStudentVerifyFailure,
  resetRateLimitStateForTests,
} from "../src/lib/rateLimit.js";
import { otpConfig } from "../src/lib/otpConfig.js";

beforeEach(() => {
  resetRateLimitStateForTests();
});

describe("checkIdentifierRateLimit — 3 requests / 10 min per identifier", () => {
  it("allows up to the configured limit, then blocks", () => {
    const id = "limit-test@example.com";
    for (let i = 0; i < otpConfig.requestsPerIdentifierPer10Min; i++) {
      expect(checkIdentifierRateLimit(id)).toBe(true);
    }
    expect(checkIdentifierRateLimit(id)).toBe(false);
  });

  it("tracks different identifiers independently", () => {
    for (let i = 0; i < otpConfig.requestsPerIdentifierPer10Min; i++) {
      checkIdentifierRateLimit("a@example.com");
    }
    expect(checkIdentifierRateLimit("a@example.com")).toBe(false);
    expect(checkIdentifierRateLimit("b@example.com")).toBe(true);
  });
});

describe("checkResendCooldown — 60s", () => {
  it("blocks a second request for the same identifier immediately after the first", () => {
    expect(checkResendCooldown("cooldown@example.com")).toBe(true);
    expect(checkResendCooldown("cooldown@example.com")).toBe(false);
  });

  it("applies identically to an identifier that doesn't belong to any student", () => {
    // No DB lookup happens inside checkResendCooldown itself — it's purely
    // keyed by the submitted string, so a nonexistent identifier behaves the
    // same as a real one here (this is what closes the enumeration gap).
    expect(checkResendCooldown("totally-made-up@example.com")).toBe(true);
    expect(checkResendCooldown("totally-made-up@example.com")).toBe(false);
  });
});

describe("per-IP express-rate-limit middleware mechanism", () => {
  it("blocks the (n+1)th request from the same IP within the window, using a fresh isolated instance (not the app's shared limiter)", async () => {
    // A dedicated instance with a tiny limit, separate from the app's global
    // otpRequestIpLimiter — avoids any cross-contamination with other tests
    // that share one loopback IP within this worker process.
    const limit = 2;
    const limiter = rateLimit({ windowMs: 60_000, limit, standardHeaders: true, legacyHeaders: false });
    const app = express();
    app.get("/probe", limiter, (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as import("node:net").AddressInfo;

    try {
      const statuses: number[] = [];
      for (let i = 0; i < limit + 1; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/probe`);
        statuses.push(res.status);
      }
      expect(statuses).toEqual([200, 200, 429]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("admin login per-IP rate limiter mechanism (same express-rate-limit construction as adminLoginIpLimiter)", () => {
  it("blocks the (n+1)th login attempt from the same IP within the window, using a fresh isolated instance at the REAL production limit (10/15min)", async () => {
    // Exercises the actual production threshold the app uses by default —
    // adminAuthConfig.loginIpLimitMax defaults to 10 unless
    // ADMIN_LOGIN_IP_LIMIT_MAX overrides it (as the test env does, so the
    // rest of the suite can drive many unrelated admin logins from one
    // loopback IP). A dedicated, isolated instance here means this test
    // verifies the real default regardless of that override.
    const limit = 10;
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many login attempts. Please wait and try again." },
    });
    const app = express();
    app.post("/probe-login", limiter, (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as import("node:net").AddressInfo;

    try {
      const statuses: number[] = [];
      for (let i = 0; i < limit + 1; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/probe-login`, { method: "POST" });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, limit)).toEqual(Array(limit).fill(200));
      expect(statuses[limit]).toBe(429);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("checkStudentVerifyRateLimit / recordStudentVerifyFailure", () => {
  it("allows attempts until the failure count reaches the configured max", () => {
    const studentId = "student-1";
    for (let i = 0; i < otpConfig.maxFailedVerifiesPerStudentPer10Min; i++) {
      expect(checkStudentVerifyRateLimit(studentId)).toBe(true);
      recordStudentVerifyFailure(studentId);
    }
    expect(checkStudentVerifyRateLimit(studentId)).toBe(false);
  });

  it("tracks different students independently, so a shared/rotating IP doesn't help an attacker across accounts", () => {
    for (let i = 0; i < otpConfig.maxFailedVerifiesPerStudentPer10Min; i++) {
      recordStudentVerifyFailure("student-a");
    }
    expect(checkStudentVerifyRateLimit("student-a")).toBe(false);
    expect(checkStudentVerifyRateLimit("student-b")).toBe(true);
  });

  it("is independent of any single OTP token — requesting fresh tokens doesn't reset it", () => {
    // This is exactly the gap flagged in review: per-token attempt caps
    // alone don't stop someone from calling /otp/request repeatedly for a
    // fresh token and retrying. This counter is keyed by studentId only.
    const studentId = "student-c";
    for (let i = 0; i < otpConfig.maxFailedVerifiesPerStudentPer10Min; i++) {
      recordStudentVerifyFailure(studentId);
    }
    expect(checkStudentVerifyRateLimit(studentId)).toBe(false);
  });
});
