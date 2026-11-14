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

export const GENERIC_REQUEST_MESSAGE = "If that email is registered, a verification code has been sent.";
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
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "unsupported_channel" };

/**
 * Request a new OTP. Always looks the same to the caller whether or not the
 * identifier is registered — no DB write and no delivery call happen for an
 * unknown identifier, but the response shape/timing-sensitive branches
 * (cooldown, rate limit) are checked identically either way so they can't be
 * used to probe which identifiers exist.
 */
export async function requestOtp(params: { channel: OtpChannel; value: string }): Promise<RequestOtpResult> {
  const { channel, value } = params;

  // Student OTP delivery is email-only. Checked here, not just at the HTTP
  // route layer, so this is a real, structural "disabled" rather than a
  // single removable gate — the SMS provider/schema enum stay in place for
  // a possible future re-enable, but no code path can mint or verify an SMS
  // OTP today. Returns before touching rate-limit state, since a request
  // that was never going to succeed shouldn't consume a student's budget.
  if (channel !== OtpChannel.EMAIL) {
    return { ok: false, reason: "unsupported_channel" };
  }

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
      // consumedAt is optional with no default; writing it explicitly as
      // null here (rather than omitting it) is a no-op on SQLite but
      // required on MongoDB — both the invalidate-prior-tokens update
      // above and verifyOtp()'s lookup below filter on `consumedAt:
      // null`, which only matches a document where that key is
      // explicitly present with value null, not one where the key is
      // simply absent.
      consumedAt: null,
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

  // Diagnostic-only, no PII/secrets: which path a request actually took.
  // Without this, a request that silently falls back to the mock provider
  // (deliveryMode=live but this student's cohort isn't realOtpEligible yet)
  // is indistinguishable in the logs from a real send that succeeded — both
  // return {ok:true} with no log line at all otherwise. Carries no
  // identifier (not even the internal DB id) — channel/mode/provider/result
  // are enough to diagnose this class of issue without logging anything
  // that could be tied back to a specific student on a routine request.
  const providerUsed = eligible ? (channel === OtpChannel.EMAIL ? otpConfig.emailProviderName : "twilio") : "mock";
  // eslint-disable-next-line no-console
  console.log(
    `[otp] request channel=${channel} deliveryMode=${otpConfig.deliveryMode} ` +
      `eligible=${eligible} providerUsed=${providerUsed} result=${result.ok ? "ok" : "failed"}`
  );

  if (!result.ok) {
    // Redacted, correlated failure record — no raw provider error text, no
    // OTP, no email/phone, anywhere. The console line and the DB row share
    // a correlation ID so an admin can look up "what kind of failure, for
    // which student, when" without either ever holding the raw message.
    //
    // The OtpProviderName schema enum only has RESEND/TWILIO — there is no
    // GMAIL_SMTP value (adding one is a schema change, deliberately not done
    // here without separate approval). A Gmail-SMTP failure is therefore
    // still console-logged (sanitized, same as any other failure) but is
    // NOT persisted to OtpDeliveryFailure, since writing RESEND for a
    // Gmail-SMTP failure would be inaccurate, not just incomplete.
    const correlationId = generateCorrelationId();
    const provider =
      channel === OtpChannel.EMAIL
        ? otpConfig.emailProviderName === "gmail_smtp"
          ? null
          : OtpProviderName.RESEND
        : OtpProviderName.TWILIO;
    if (provider) {
      await prisma.otpDeliveryFailure.create({
        data: { correlationId, studentId: student.id, channel, provider, category: result.category },
      });
    }
    // eslint-disable-next-line no-console
    console.error(
      `[otp] delivery failed correlationId=${correlationId} category=${result.category}` +
        (provider ? "" : " provider=GMAIL_SMTP (not persisted — see comment above)")
    );
  }

  return { ok: true, expiresAt, cooldownSeconds: otpConfig.resendCooldownMs / 1000 };
}

export type VerifyOtpResult =
  | { ok: true; token: string; sessionExpiresAt: Date; student: { id: string; firstName: string; lastName: string; email: string } }
  | { ok: false; reason: "invalid" | "rate_limited" | "unsupported_channel" };

export async function verifyOtp(params: { channel: OtpChannel; value: string; code: string }): Promise<VerifyOtpResult> {
  const { channel, value, code } = params;

  // See the matching guard in requestOtp() — email-only, enforced here too
  // so verification can't succeed for a channel that was never a valid way
  // to receive the code in the first place.
  if (channel !== OtpChannel.EMAIL) {
    return { ok: false, reason: "unsupported_channel" };
  }

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
