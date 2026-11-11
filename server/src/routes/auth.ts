import { Router } from "express";
import { prisma } from "../prisma.js";
import { OtpChannel, requestOtp, verifyOtp, GENERIC_REQUEST_MESSAGE, GENERIC_VERIFY_ERROR, GENERIC_TOO_MANY } from "../lib/otp.js";
import { normalizePhoneToE164 } from "../lib/phone.js";
import { otpRequestIpLimiter, otpVerifyIpLimiter } from "../lib/rateLimit.js";

export const authRouter = Router();

type Identifier = { channel: OtpChannel; value: string };

/** Exactly one of email/phone, never both — closes the old OR-match mix-up. */
function parseIdentifier(body: Record<string, unknown>): Identifier | "invalid" {
  const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
  const phoneRaw = typeof body.phone === "string" ? body.phone.trim() : "";
  const hasEmail = emailRaw.length > 0;
  const hasPhone = phoneRaw.length > 0;

  if (hasEmail === hasPhone) {
    // Neither provided, or both provided — both are rejected the same way.
    return "invalid";
  }

  if (hasEmail) {
    return { channel: OtpChannel.EMAIL, value: emailRaw.toLowerCase() };
  }

  const normalized = normalizePhoneToE164(phoneRaw);
  if (!normalized.ok) {
    return "invalid";
  }
  return { channel: OtpChannel.SMS, value: normalized.e164 };
}

authRouter.post("/otp/request", otpRequestIpLimiter, async (req, res) => {
  const identifier = parseIdentifier(req.body as Record<string, unknown>);
  if (identifier === "invalid") {
    res.status(400).json({ error: "Enter exactly one: a valid email or a valid phone number." });
    return;
  }

  const result = await requestOtp(identifier);
  if (!result.ok) {
    res.status(429).json({ error: GENERIC_TOO_MANY });
    return;
  }

  res.json({
    ok: true,
    message: GENERIC_REQUEST_MESSAGE,
    expiresAt: result.expiresAt.toISOString(),
    cooldownSeconds: result.cooldownSeconds,
  });
});

authRouter.post("/otp/verify", otpVerifyIpLimiter, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const identifier = parseIdentifier(body);
  const codeStr = typeof body.code === "string" ? body.code.trim() : "";

  if (identifier === "invalid" || !codeStr) {
    res.status(400).json({ error: "Enter exactly one of email/phone, and the code." });
    return;
  }

  const result = await verifyOtp({ ...identifier, code: codeStr });
  if (!result.ok) {
    const status = result.reason === "rate_limited" ? 429 : 401;
    const message = result.reason === "rate_limited" ? GENERIC_TOO_MANY : GENERIC_VERIFY_ERROR;
    res.status(status).json({ error: message });
    return;
  }

  res.json({
    token: result.token,
    expiresAt: result.sessionExpiresAt.toISOString(),
    student: result.student,
  });
});

authRouter.post("/logout", async (req, res) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    await prisma.studentSession.deleteMany({ where: { token } });
  }
  res.status(204).send();
});
