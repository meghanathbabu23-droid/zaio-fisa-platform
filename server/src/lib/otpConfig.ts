/**
 * Single source of truth for OTP/auth environment config. Read once, validated
 * once — nothing else in the app should read these process.env keys directly,
 * to avoid the kind of drift that caused the old inverted SIMULATE_OTP_DELIVERY
 * default (`!== "false"` meant a typo or missing var silently enabled it).
 */

export type OtpDeliveryMode = "live" | "mock";
export type EmailProviderName = "resend" | "gmail_smtp";

function readMode(): OtpDeliveryMode {
  const raw = (process.env.OTP_DELIVERY_MODE ?? "").trim().toLowerCase();
  return raw === "mock" ? "mock" : "live";
}

/** Which live email provider to use when deliveryMode is "live". Mock mode
 * ignores this entirely (always uses MockEmailProvider). Defaults to
 * "resend" so existing deployments/tests are unaffected unless this is
 * explicitly set. */
function readEmailProviderName(): EmailProviderName {
  const raw = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  return raw === "gmail_smtp" ? "gmail_smtp" : "resend";
}

export const otpConfig = {
  hashSecret: process.env.OTP_HASH_SECRET ?? "",
  deliveryMode: readMode(),
  emailProviderName: readEmailProviderName(),
  defaultPhoneRegion: (process.env.DEFAULT_PHONE_REGION ?? "ZA").toUpperCase(),

  otpTtlMs: 10 * 60 * 1000,
  sessionTtlMs: 8 * 60 * 60 * 1000,
  resendCooldownMs: 60 * 1000,
  maxAttemptsPerToken: 5,

  // Rate limits (§6 of the approved spec). The per-IP limits are raised in
  // the test environment only (NODE_ENV=test, set by vitest.config.ts) —
  // many unrelated test cases share one loopback IP within a single worker
  // process, which would otherwise trip the real production threshold as
  // test-order-dependent pollution rather than a real finding. The
  // per-identifier/per-student limits below are NOT raised — those are what
  // the test suite is actually trying to exercise.
  requestsPerIpPerHour: process.env.NODE_ENV === "test" ? 10_000 : 5,
  requestsPerIdentifierPer10Min: 3,
  verifyAttemptsPerIpPer10Min: process.env.NODE_ENV === "test" ? 10_000 : 10,
  // Not in the approved table explicitly — added because a per-token attempt
  // cap alone doesn't stop someone from minting fresh tokens via repeated
  // /otp/request calls to reset their guess budget. Mirrors the per-IP verify
  // figure as a reasonable default; per-student rather than per-IP so it
  // still bites even from a rotating/shared IP.
  maxFailedVerifiesPerStudentPer10Min: 10,

  resend: {
    apiKey: process.env.RESEND_API_KEY ?? "",
    fromEmail: process.env.RESEND_FROM_EMAIL ?? "",
    fromName: process.env.RESEND_FROM_NAME ?? "Zaio FISA",
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    fromNumber: process.env.TWILIO_PHONE_NUMBER ?? "",
  },
  gmailSmtp: {
    user: process.env.SMTP_USER ?? "",
    appPassword: process.env.SMTP_APP_PASSWORD ?? "",
  },
};

/** Exported for reuse anywhere else that needs the same "looks like an
 * email" shape check (e.g. open-test-registration input validation) —
 * deliberately a single definition rather than a second regex drifting out
 * of sync with this one. */
export const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TWILIO_SID_RE = /^AC[a-f0-9]{32}$/i;
const TWILIO_TOKEN_RE = /^[a-f0-9]{32}$/i;
const E164_RE = /^\+[1-9]\d{6,14}$/;

/**
 * Checks every required live-delivery credential for presence AND basic
 * format validity (not just "is it a non-empty string"). Returns the list of
 * problems found — empty means fully configured and shaped correctly.
 *
 * Resend-only: Resend is the sole provider live student OTP delivery needs
 * today, since the SMS/phone channel is disabled (lib/otp.ts's requestOtp()/
 * verifyOtp() reject it outright before any provider is ever selected).
 * Twilio credentials are deliberately NOT checked here — see
 * validateTwilioProviderConfig() below.
 */
export function validateLiveProviderConfig(): string[] {
  const problems: string[] = [];

  if (!otpConfig.resend.apiKey) {
    problems.push("RESEND_API_KEY is missing");
  } else if (otpConfig.resend.apiKey.length < 10) {
    problems.push("RESEND_API_KEY looks too short to be a real key");
  }

  if (!otpConfig.resend.fromEmail) {
    problems.push("RESEND_FROM_EMAIL is missing");
  } else if (!EMAIL_SHAPE_RE.test(otpConfig.resend.fromEmail)) {
    problems.push("RESEND_FROM_EMAIL is not a valid email address");
  }

  return problems;
}

/**
 * Gmail SMTP credential validation — checked only when emailProviderName is
 * "gmail_smtp". A Gmail App Password is a 16-character value (Google shows
 * it with spaces, e.g. "abcd efgh ijkl mnop"); spaces are stripped before
 * the length check since either form is a valid way to paste it into .env.
 */
export function validateGmailSmtpConfig(): string[] {
  const problems: string[] = [];

  if (!otpConfig.gmailSmtp.user) {
    problems.push("SMTP_USER is missing");
  } else if (!EMAIL_SHAPE_RE.test(otpConfig.gmailSmtp.user)) {
    problems.push("SMTP_USER is not a valid email address");
  }

  const appPasswordDigits = otpConfig.gmailSmtp.appPassword.replace(/\s/g, "");
  if (!appPasswordDigits) {
    problems.push("SMTP_APP_PASSWORD is missing");
  } else if (appPasswordDigits.length < 16) {
    problems.push("SMTP_APP_PASSWORD looks too short to be a real Gmail App Password (expected 16 characters)");
  }

  return problems;
}

/** Validates whichever email provider is actually selected for live mode —
 * Resend or Gmail SMTP, never both. Call this instead of
 * validateLiveProviderConfig() directly anywhere that needs to know "is live
 * email delivery actually ready right now," so the check always matches
 * EMAIL_PROVIDER. */
export function validateActiveEmailProviderConfig(): string[] {
  return otpConfig.emailProviderName === "gmail_smtp" ? validateGmailSmtpConfig() : validateLiveProviderConfig();
}

/**
 * Twilio/SMS credential validation. NOT called by assertOtpConfigSafeToBoot()
 * or the admin delivery-status endpoint today — student phone/SMS login is
 * disabled, so Twilio configuration has no bearing on whether live student
 * OTP delivery actually works. Kept, rather than deleted, purely so the
 * format-checking logic isn't lost if the SMS channel is ever re-enabled —
 * at that point, re-wire this back into the live-mode boot check.
 */
export function validateTwilioProviderConfig(): string[] {
  const problems: string[] = [];

  if (!otpConfig.twilio.accountSid) {
    problems.push("TWILIO_ACCOUNT_SID is missing");
  } else if (!TWILIO_SID_RE.test(otpConfig.twilio.accountSid)) {
    problems.push('TWILIO_ACCOUNT_SID does not look like a Twilio SID (expected "AC" + 32 hex chars)');
  }

  if (!otpConfig.twilio.authToken) {
    problems.push("TWILIO_AUTH_TOKEN is missing");
  } else if (!TWILIO_TOKEN_RE.test(otpConfig.twilio.authToken)) {
    problems.push("TWILIO_AUTH_TOKEN does not look like a Twilio auth token (expected 32 hex chars)");
  }

  if (!otpConfig.twilio.fromNumber) {
    problems.push("TWILIO_PHONE_NUMBER is missing");
  } else if (!E164_RE.test(otpConfig.twilio.fromNumber)) {
    problems.push("TWILIO_PHONE_NUMBER is not a valid E.164 number (e.g. +15551234567)");
  }

  return problems;
}

/**
 * Boot-time safety checks. Called once from index.ts before the server starts
 * listening. Throws (refuses to boot) rather than silently running insecurely.
 *
 * Fail-closed, not environment-dependent: "live" mode with any missing or
 * malformed credential refuses to start in every environment, not just
 * production. There is no "warn and continue" path for live mode anymore —
 * the only way to run without real credentials is OTP_DELIVERY_MODE=mock.
 */
export function assertOtpConfigSafeToBoot(): void {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && otpConfig.deliveryMode === "mock") {
    throw new Error(
      "Refusing to start: NODE_ENV=production but OTP_DELIVERY_MODE=mock. " +
        "Production must never use mock OTP delivery."
    );
  }

  if (!otpConfig.hashSecret || otpConfig.hashSecret.length < 16) {
    if (isProduction || otpConfig.deliveryMode === "live") {
      throw new Error(
        "Refusing to start: OTP_HASH_SECRET is missing or too short (need >= 16 chars)."
      );
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[otpConfig] OTP_HASH_SECRET is missing or short — using it anyway for local/dev use only (mock delivery mode)."
    );
  }

  if (otpConfig.deliveryMode === "live") {
    const problems = validateActiveEmailProviderConfig();
    if (problems.length) {
      throw new Error(
        `Refusing to start: OTP_DELIVERY_MODE=live (EMAIL_PROVIDER=${otpConfig.emailProviderName}) but provider configuration is invalid:\n` +
          problems.map((p) => `  - ${p}`).join("\n") +
          `\nSet OTP_DELIVERY_MODE=mock for local development/testing without real provider credentials. ` +
          `There is no automatic fallback to mock — live mode either boots fully configured or not at all.`
      );
    }
  }
}
