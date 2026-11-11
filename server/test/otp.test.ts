import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/prisma.js";
import { requestOtp, verifyOtp, OtpChannel } from "../src/lib/otp.js";
import { hashOtp, hashesMatch, generateOtpCode } from "../src/lib/crypto.js";
import { otpConfig } from "../src/lib/otpConfig.js";
import { MockEmailProvider, MockSmsProvider } from "../src/lib/providers/index.js";
import { resetRateLimitStateForTests } from "../src/lib/rateLimit.js";
import { createTestStudent } from "./helpers.js";

beforeEach(() => {
  resetRateLimitStateForTests();
  MockEmailProvider.sent.clear();
  MockSmsProvider.sent.clear();
});

describe("crypto: OTP generation and hashing", () => {
  it("generates a 6-digit numeric code", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("hashes deterministically with HMAC and the configured secret", () => {
    const h1 = hashOtp("123456");
    const h2 = hashOtp("123456");
    expect(h1).toBe(h2);
    expect(h1).not.toBe("123456");
  });

  it("produces different hashes for different codes", () => {
    expect(hashOtp("123456")).not.toBe(hashOtp("654321"));
  });

  it("hashesMatch is true only for equal hashes, using constant-time compare", () => {
    const h = hashOtp("111111");
    expect(hashesMatch(h, h)).toBe(true);
    expect(hashesMatch(h, hashOtp("222222"))).toBe(false);
  });

  it("hashesMatch handles mismatched lengths safely (no throw)", () => {
    expect(hashesMatch("ab", hashOtp("111111"))).toBe(false);
  });
});

describe("otp: requestOtp + verifyOtp — email channel", () => {
  it("valid OTP verifies successfully and issues a session", async () => {
    const student = await createTestStudent();
    await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });
    const captured = MockEmailProvider.sent.get(student.email);
    expect(captured).toBeDefined();

    const result = await verifyOtp({ channel: OtpChannel.EMAIL, value: student.email, code: captured!.code });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.student.id).toBe(student.id);
      expect(typeof result.token).toBe("string");
      expect(result.token.length).toBeGreaterThan(20);
    }
  });

  it("rejects an invalid code", async () => {
    const student = await createTestStudent();
    await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });
    const result = await verifyOtp({ channel: OtpChannel.EMAIL, value: student.email, code: "000000" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
  });

  it("rejects an expired OTP", async () => {
    const student = await createTestStudent();
    await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });
    const captured = MockEmailProvider.sent.get(student.email)!;
    // Force the stored token to already be expired.
    await prisma.otpToken.updateMany({
      where: { studentId: student.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await verifyOtp({ channel: OtpChannel.EMAIL, value: student.email, code: captured.code });
    expect(result.ok).toBe(false);
  });

  it("rejects a reused (already-consumed) OTP", async () => {
    const student = await createTestStudent();
    await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });
    const captured = MockEmailProvider.sent.get(student.email)!;
    const first = await verifyOtp({ channel: OtpChannel.EMAIL, value: student.email, code: captured.code });
    expect(first.ok).toBe(true);

    const second = await verifyOtp({ channel: OtpChannel.EMAIL, value: student.email, code: captured.code });
    expect(second.ok).toBe(false);
  });

  it("locks out a token after 5 incorrect attempts", async () => {
    const student = await createTestStudent();
    await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });
    const captured = MockEmailProvider.sent.get(student.email)!;

    for (let i = 0; i < otpConfig.maxAttemptsPerToken; i++) {
      const bad = await verifyOtp({ channel: OtpChannel.EMAIL, value: student.email, code: "999999" });
      expect(bad.ok).toBe(false);
    }

    // Even the correct code is now rejected — the token is locked out.
    const correctButLocked = await verifyOtp({ channel: OtpChannel.EMAIL, value: student.email, code: captured.code });
    expect(correctButLocked.ok).toBe(false);
  });

  it("a new request invalidates the previous outstanding OTP", async () => {
    const student = await createTestStudent();
    await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });
    const first = MockEmailProvider.sent.get(student.email)!.code;

    // Simulate the resend cooldown having already passed, so this test is
    // exercising invalidation, not accidentally hitting the cooldown gate
    // (which is covered separately in rateLimit.test.ts / httpAuth.test.ts).
    resetRateLimitStateForTests();

    await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });
    const result = await verifyOtp({ channel: OtpChannel.EMAIL, value: student.email, code: first });
    expect(result.ok).toBe(false);
  });

  it("sets emailVerifiedAt on first successful email verification", async () => {
    const student = await createTestStudent();
    expect(student.emailVerifiedAt).toBeNull();
    await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });
    const code = MockEmailProvider.sent.get(student.email)!.code;
    await verifyOtp({ channel: OtpChannel.EMAIL, value: student.email, code });
    const updated = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(updated.emailVerifiedAt).not.toBeNull();
  });
});

describe("otp: requestOtp + verifyOtp — SMS channel", () => {
  it("valid OTP via phone/SMS verifies successfully", async () => {
    const student = await createTestStudent({ phone: "+27821119001" });
    await requestOtp({ channel: OtpChannel.SMS, value: student.phone! });
    const captured = MockSmsProvider.sent.get(student.phone!);
    expect(captured).toBeDefined();
    const result = await verifyOtp({ channel: OtpChannel.SMS, value: student.phone!, code: captured!.code });
    expect(result.ok).toBe(true);
  });

  it("sets phoneVerifiedAt (not emailVerifiedAt) on SMS verification", async () => {
    const student = await createTestStudent({ phone: "+27821119002" });
    await requestOtp({ channel: OtpChannel.SMS, value: student.phone! });
    const code = MockSmsProvider.sent.get(student.phone!)!.code;
    await verifyOtp({ channel: OtpChannel.SMS, value: student.phone!, code });
    const updated = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(updated.phoneVerifiedAt).not.toBeNull();
    expect(updated.emailVerifiedAt).toBeNull();
  });

  it("an email OTP cannot be used to verify via the phone channel, and vice versa", async () => {
    const student = await createTestStudent({ phone: "+27821119003" });
    await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });
    const emailCode = MockEmailProvider.sent.get(student.email)!.code;
    const result = await verifyOtp({ channel: OtpChannel.SMS, value: student.phone!, code: emailCode });
    expect(result.ok).toBe(false);
  });
});

describe("otp: unknown identifiers get the same generic outcome", () => {
  it("requestOtp for an unregistered email does not throw and returns ok:true", async () => {
    const result = await requestOtp({ channel: OtpChannel.EMAIL, value: "nobody@example.com" });
    expect(result.ok).toBe(true);
  });

  it("requestOtp for an unregistered email never calls the delivery provider", async () => {
    await requestOtp({ channel: OtpChannel.EMAIL, value: "nobody-else@example.com" });
    expect(MockEmailProvider.sent.has("nobody-else@example.com")).toBe(false);
  });

  it("verifyOtp for an unregistered identifier returns the same 'invalid' shape as a wrong code", async () => {
    const result = await verifyOtp({ channel: OtpChannel.EMAIL, value: "nobody-verify@example.com", code: "123456" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
  });
});
