import { Router } from "express";
import { prisma } from "../prisma.js";
import { otpConfig } from "../lib/otpConfig.js";
import { validateLiveProviderConfig } from "../lib/otpConfig.js";

/** SUPER_ADMIN-only visibility into OTP delivery configuration and
 * per-cohort eligibility — never returns a secret value, only
 * presence/validity booleans and problem descriptions (which name a missing
 * env var, never its value). */
export const adminStatusRouter = Router();

adminStatusRouter.get("/delivery", async (_req, res) => {
  const problems = otpConfig.deliveryMode === "live" ? validateLiveProviderConfig() : [];
  const cohorts = await prisma.cohort.findMany({
    select: { id: true, name: true, realOtpEligible: true },
    orderBy: { name: "asc" },
  });

  res.json({
    deliveryMode: otpConfig.deliveryMode,
    providerConfigValid: problems.length === 0,
    providerConfigProblems: problems,
    resendFromEmailConfigured: Boolean(otpConfig.resend.fromEmail),
    twilioFromNumberConfigured: Boolean(otpConfig.twilio.fromNumber),
    cohorts,
  });
});
