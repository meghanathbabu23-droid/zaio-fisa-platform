import { Router } from "express";
import { prisma } from "../prisma.js";
import { otpConfig } from "../lib/otpConfig.js";
import { validateActiveEmailProviderConfig } from "../lib/otpConfig.js";

/** SUPER_ADMIN-only visibility into OTP delivery configuration and
 * per-cohort eligibility — never returns a secret value, only
 * presence/validity booleans and problem descriptions (which name a missing
 * env var, never its value).
 *
 * Email-only: student OTP delivery only ever uses whichever email provider
 * EMAIL_PROVIDER selects (Resend or Gmail SMTP) — the SMS/phone channel is
 * disabled (see lib/otp.ts), so there is deliberately no Twilio field here. */
export const adminStatusRouter = Router();

adminStatusRouter.get("/delivery", async (_req, res) => {
  const problems = otpConfig.deliveryMode === "live" ? validateActiveEmailProviderConfig() : [];
  const cohorts = await prisma.cohort.findMany({
    select: { id: true, name: true, realOtpEligible: true },
    orderBy: { name: "asc" },
  });

  res.json({
    deliveryMode: otpConfig.deliveryMode,
    emailProvider: otpConfig.emailProviderName,
    providerConfigValid: problems.length === 0,
    providerConfigProblems: problems,
    resendFromEmailConfigured: Boolean(otpConfig.resend.fromEmail),
    smtpUserConfigured: Boolean(otpConfig.gmailSmtp.user),
    cohorts,
  });
});
