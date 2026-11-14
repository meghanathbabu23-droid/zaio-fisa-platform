import { Router } from "express";
import { prisma } from "../prisma.js";
import { OtpChannel, requestOtp, verifyOtp, GENERIC_REQUEST_MESSAGE, GENERIC_VERIFY_ERROR, GENERIC_TOO_MANY } from "../lib/otp.js";
import { otpRequestIpLimiter, otpVerifyIpLimiter } from "../lib/rateLimit.js";

export const authRouter = Router();

type Identifier = { channel: OtpChannel; value: string };

const INVALID_IDENTIFIER_MESSAGE = "Enter your registered Zaio email.";

/**
 * Student OTP sign-in is email-only. A `phone` field is rejected outright
 * (not silently ignored) — whether it's sent alone or alongside `email` —
 * so a stale client still offering a phone option gets a clear error rather
 * than a request that quietly succeeds on the email half. See lib/otp.ts's
 * matching channel guards in requestOtp()/verifyOtp() for the second,
 * independent layer of this same restriction.
 */
function parseIdentifier(body: Record<string, unknown>): Identifier | "invalid" {
  const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
  const phoneRaw = typeof body.phone === "string" ? body.phone.trim() : "";

  if (!emailRaw || phoneRaw) {
    return "invalid";
  }

  return { channel: OtpChannel.EMAIL, value: emailRaw.toLowerCase() };
}

authRouter.post("/otp/request", otpRequestIpLimiter, async (req, res) => {
  const identifier = parseIdentifier(req.body as Record<string, unknown>);
  if (identifier === "invalid") {
    res.status(400).json({ error: INVALID_IDENTIFIER_MESSAGE });
    return;
  }

  const result = await requestOtp(identifier);
  if (!result.ok) {
    if (result.reason === "unsupported_channel") {
      res.status(400).json({ error: INVALID_IDENTIFIER_MESSAGE });
      return;
    }
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
    res.status(400).json({ error: "Enter your registered Zaio email, and the code." });
    return;
  }

  const result = await verifyOtp({ ...identifier, code: codeStr });
  if (!result.ok) {
    if (result.reason === "unsupported_channel") {
      res.status(400).json({ error: INVALID_IDENTIFIER_MESSAGE });
      return;
    }
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
