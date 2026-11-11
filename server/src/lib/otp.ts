import { OtpChannel, OtpProviderName } from "@prisma/client";
import { prisma } from "../prisma.js";
import { otpConfig } from "./otpConfig.js";
import { generateCorrelationId, generateOtpCode, generateSessionToken, hashOtp, hashesMatch } from "./crypto.js";
import { getEmailProvider, getSmsProvider, MockEmailProvider, MockSmsProvider } from "./providers/index.js";
import {
  checkIdentifierRateLimit,
  checkResendCooldown,
  checkStudentVerifyRateLimit,
  recordStudentVerifyFailure,
} from "./rateLimit.js";

export const GENERIC_REQUEST_MESSAGE = "If that email or phone is registered, a verification code has been sent.";
export const GENERIC_VERIFY_ERROR = "Invalid code. Please request a new one.";
export const GENERIC_TOO_MANY = "Too many requests. Please wait and try again.";

export { OtpChannel };

export async function findStudentByIdentifier(channel: OtpChannel, value: string) {
  return channel === OtpChannel.EMAIL
    ? prisma.student.findUnique({ where: { email: value }, include: { cohort: true } })
    : prisma.student.findUnique({ where: { phone: value }, include: { cohort: true } });
}

/**
 * Real delivery requires BOTH the server-wide OTP_DELIVERY_MODE=live AND the
 * student's cohort having been explicitly marked eligible — a cohort stays
 * mock-only until an admin turns this on for it, even while the server is
 * globally in live mode. This is what stops cohorts with still-fictional
 * contact details from ever reaching Resend/Twilio by accident.
 */
export function isEligibleForRealDelivery(student: { cohort: { realOtpEligible: boolean } }): boolean {
  return otpConfig.deliveryMode === "live" && student.cohort.realOtpEligible;
}

export type RequestOtpResult =
  | { ok: true; expiresAt: Date; cooldownSeconds: number }
  | { ok: false; reason: "rate_limited" };

/**
 * Request a new OTP. Always looks the same to the caller whether or not the
 * identifier is registered — no DB write and no delivery call happen for an
 * unknown identifier, but the response shape/timing-sensitive branches
 * (cooldown, rate limit) are checked identically either way so they can't be
 * used to probe which identifiers exist.
 */
export async function requestOtp(params: { channel: OtpChannel; value: string }): Promise<RequestOtpResult> {
  const { channel, value } = params;

  if (!checkResendCooldown(value) || !checkIdentifierRateLimit(value)) {
    return { ok: false, reason: "rate_limited" };
  }

  const expiresAt = new Date(Date.now() + otpConfig.otpTtlMs);
  const student = await findStudentByIdentifier(channel, value);
  if (!student) {
    return { ok: true, expiresAt, cooldownSeconds: otpConfig.resendCooldownMs / 1000 };
  }

  await prisma.otpToken.updateMany({
    where: { studentId: student.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = generateOtpCode();
  await prisma.otpToken.create({
    data: {
      studentId: student.id,
      channel,
      codeHash: hashOtp(code),
      expiresAt,
    },
  });

  // Global live mode is necessary but not sufficient — the student's cohort
  // must also be explicitly marked eligible, otherwise this falls through to
  // the mock provider even while the server itself is in "live" mode. This
  // is what prevents a cohort with still-fictional contact details from ever
  // reaching Resend/Twilio just because the server has been switched live
  // for some other, already-updated cohort.
  const eligible = isEligibleForRealDelivery(student);
  const result =
    channel === OtpChannel.EMAIL
      ? await (eligible ? getEmailProvider() : new MockEmailProvider()).sendOtpEmail(value, code, expiresAt)
      : await (eligible ? getSmsProvider() : new MockSmsProvider()).sendOtpSms(value, code, expiresAt);

  if (!result.ok) {
    // Redacted, correlated failure record — no raw provider error text, no
    // OTP, no email/phone, anywhere. The console line and the DB row share
    // a correlation ID so an admin can look up "what kind of failure, for
    // which student, when" without either ever holding the raw message.
    const correlationId = generateCorrelationId();
    await prisma.otpDeliveryFailure.create({
      data: {
        correlationId,
        studentId: student.id,
        channel,
        provider: channel === OtpChannel.EMAIL ? OtpProviderName.RESEND : OtpProviderName.TWILIO,
        category: result.category,
      },
    });
    // eslint-disable-next-line no-console
    console.error(`[otp] delivery failed correlationId=${correlationId} category=${result.category}`);
  }

  return { ok: true, expiresAt, cooldownSeconds: otpConfig.resendCooldownMs / 1000 };
}

export type VerifyOtpResult =
  | { ok: true; token: string; sessionExpiresAt: Date; student: { id: string; firstName: string; lastName: string; email: string } }
  | { ok: false; reason: "invalid" | "rate_limited" };

export async function verifyOtp(params: { channel: OtpChannel; value: string; code: string }): Promise<VerifyOtpResult> {
  const { channel, value, code } = params;

  const student = await findStudentByIdentifier(channel, value);
  if (!student) {
    return { ok: false, reason: "invalid" };
  }

  if (!checkStudentVerifyRateLimit(student.id)) {
    return { ok: false, reason: "rate_limited" };
  }

  const candidate = await prisma.otpToken.findFirst({
    where: { studentId: student.id, channel, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!candidate || candidate.attempts >= otpConfig.maxAttemptsPerToken) {
    recordStudentVerifyFailure(student.id);
    return { ok: false, reason: "invalid" };
  }

  const computedHash = hashOtp(code);
  if (!hashesMatch(computedHash, candidate.codeHash)) {
    await prisma.otpToken.update({ where: { id: candidate.id }, data: { attempts: { increment: 1 } } });
    recordStudentVerifyFailure(student.id);
    return { ok: false, reason: "invalid" };
  }

  const now = new Date();
  const token = generateSessionToken();
  const sessionExpiresAt = new Date(now.getTime() + otpConfig.sessionTtlMs);

  await prisma.$transaction([
    prisma.otpToken.update({ where: { id: candidate.id }, data: { consumedAt: now } }),
    prisma.student.update({
      where: { id: student.id },
      data: channel === OtpChannel.EMAIL ? { emailVerifiedAt: now } : { phoneVerifiedAt: now },
    }),
    // Revoke every other active session for this student before issuing the new one.
    prisma.studentSession.deleteMany({ where: { studentId: student.id } }),
    prisma.studentSession.create({ data: { token, studentId: student.id, expiresAt: sessionExpiresAt } }),
  ]);

  return {
    ok: true,
    token,
    sessionExpiresAt,
    student: { id: student.id, firstName: student.firstName, lastName: student.lastName, email: student.email },
  };
}
