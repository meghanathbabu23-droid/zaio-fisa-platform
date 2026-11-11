import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { otpConfig } from "./otpConfig.js";

/** HMAC-SHA256 with a server-side secret pepper — defeats precomputed-table
 * attacks against the small 6-digit code space if the DB ever leaks. */
export function hashOtp(code: string): string {
  return createHmac("sha256", otpConfig.hashSecret || "dev-only-insecure-secret")
    .update(code)
    .digest("hex");
}

/** Constant-time comparison of two hex-encoded hashes. */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function generateOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/** Short, non-sensitive ID used only to link a sanitized log line to its
 * matching OtpDeliveryFailure row — not a secret, never derived from the OTP. */
export function generateCorrelationId(): string {
  return randomBytes(6).toString("hex");
}
