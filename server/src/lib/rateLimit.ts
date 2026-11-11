import rateLimit from "express-rate-limit";
import { otpConfig } from "./otpConfig.js";

/**
 * In-memory rate limiting — correct and sufficient for a single Node process
 * (this app's current deployment shape). If FISA ever runs multiple server
 * instances behind a load balancer, these in-memory counters stop being
 * accurate per-identifier/per-student across instances; swap the stores
 * below for a shared one (e.g. `rate-limit-redis` backed by Redis, or a
 * dedicated DB table) at that point. The function signatures here wouldn't
 * need to change.
 */

function genericLimitMessage() {
  return { error: "Too many requests. Please wait and try again." };
}

/** Per-IP limit on how often /otp/request can be called. */
export const otpRequestIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: otpConfig.requestsPerIpPerHour,
  standardHeaders: true,
  legacyHeaders: false,
  message: genericLimitMessage(),
});

/** Per-IP limit on /otp/verify attempts. */
export const otpVerifyIpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: otpConfig.verifyAttemptsPerIpPer10Min,
  standardHeaders: true,
  legacyHeaders: false,
  message: genericLimitMessage(),
});

function pruneAndCount(map: Map<string, number[]>, key: string, windowMs: number): number[] {
  const now = Date.now();
  const hits = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  map.set(key, hits);
  return hits;
}

/** Per-identifier (post-normalization email/phone) request limit — 3/10min,
 * independent of which IP the requests arrive from. */
const identifierRequestHits = new Map<string, number[]>();

export function checkIdentifierRateLimit(identifier: string): boolean {
  const hits = pruneAndCount(identifierRequestHits, identifier, 10 * 60 * 1000);
  if (hits.length >= otpConfig.requestsPerIdentifierPer10Min) return false;
  hits.push(Date.now());
  identifierRequestHits.set(identifier, hits);
  return true;
}

/** Resend cooldown — tracked by the raw submitted identifier, checked and
 * recorded unconditionally (whether or not a student actually exists for
 * it), so a nonexistent identifier can't be probed faster than a real one
 * just because it never hits this cooldown. */
const lastRequestAt = new Map<string, number>();

export function checkResendCooldown(identifier: string): boolean {
  const last = lastRequestAt.get(identifier);
  const now = Date.now();
  if (last !== undefined && now - last < otpConfig.resendCooldownMs) {
    return false;
  }
  lastRequestAt.set(identifier, now);
  return true;
}

/** Per-student rolling lockout on failed verify attempts, independent of any
 * single OTP token — stops an attacker from resetting their guess budget by
 * repeatedly calling /otp/request for fresh tokens. */
const studentVerifyFailures = new Map<string, number[]>();

export function checkStudentVerifyRateLimit(studentId: string): boolean {
  const hits = pruneAndCount(studentVerifyFailures, studentId, 10 * 60 * 1000);
  return hits.length < otpConfig.maxFailedVerifiesPerStudentPer10Min;
}

export function recordStudentVerifyFailure(studentId: string): void {
  const hits = studentVerifyFailures.get(studentId) ?? [];
  hits.push(Date.now());
  studentVerifyFailures.set(studentId, hits);
}

/** Test-only: clear all in-memory limiter state between test cases. */
export function resetRateLimitStateForTests(): void {
  identifierRequestHits.clear();
  lastRequestAt.clear();
  studentVerifyFailures.clear();
}
