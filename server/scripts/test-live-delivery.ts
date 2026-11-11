/**
 * Part E — guarded REAL-provider delivery test. Sends exactly one real
 * email (Resend) and/or one real SMS (Twilio) to the exact recipient(s)
 * given on the command line.
 *
 * NEVER auto-invoked by any test, the demo smoke script, or CI — this file
 * is not imported by anything else in the codebase. Only a human runs it
 * directly, deliberately, e.g.:
 *
 *   npm run test:live-delivery -- --email you@yourdomain.com --sms +15551234567 --confirm
 *
 * Safety properties, all enforced below, not just documented:
 *   - Refuses to run without --confirm (typo-proofing — the flags above
 *     alone aren't enough to fire this).
 *   - Refuses unless OTP_DELIVERY_MODE=live and every Resend/Twilio
 *     credential is present and well-formed (the same check the server
 *     itself uses to decide whether to boot in live mode).
 *   - Never reads the database — no student, cohort, or assignment table is
 *     touched. The only recipients that can ever receive anything are the
 *     exact --email / --sms values typed on this command line.
 *   - Never generates or stores an OTP. The test message is NOT a login
 *     code and cannot be used to sign in anywhere.
 *   - Prints only the provider's own message id / delivery status — never
 *     logs or persists the recipient address anywhere beyond this one
 *     console run, and writes nothing to the database.
 *
 * This script cannot confirm the message was actually received — only that
 * the provider's API accepted it. Confirm real receipt by checking the
 * recipient inbox/phone yourself before relying on this as proof delivery
 * works end to end.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(__dirname, "../.env"));
} catch {
  // Fine if absent — env vars may already be set in the shell.
}

const { otpConfig, validateLiveProviderConfig } = await import("../src/lib/otpConfig.js");
const { ResendEmailProvider } = await import("../src/lib/providers/emailProvider.js");
const { TwilioSmsProvider } = await import("../src/lib/providers/smsProvider.js");

const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;

function parseArgs(): { email?: string; sms?: string; confirm: boolean } {
  const out: { email?: string; sms?: string; confirm: boolean } = { confirm: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--email") out.email = argv[++i];
    else if (arg === "--sms") out.sms = argv[++i];
    else if (arg === "--confirm") out.confirm = true;
  }
  return out;
}

function usage(): string {
  return (
    "Usage: npm run test:live-delivery -- --email you@yourdomain.com --sms +15551234567 --confirm\n" +
    "  --email   a single, real address YOU control — never a student's address\n" +
    "  --sms     a single, real E.164 number YOU control — never a student's number\n" +
    "  --confirm required — acknowledges this sends REAL messages, no dry-run mode\n" +
    "At least one of --email / --sms is required; both may be given together."
  );
}

async function main() {
  const { email, sms, confirm } = parseArgs();

  if (!confirm) {
    console.error(`Refusing to run without --confirm.\n\n${usage()}`);
    process.exitCode = 1;
    return;
  }
  if (!email && !sms) {
    console.error(`Nothing to send — pass --email and/or --sms.\n\n${usage()}`);
    process.exitCode = 1;
    return;
  }
  if (email && !EMAIL_SHAPE_RE.test(email)) {
    console.error("--email is not a valid email address.");
    process.exitCode = 1;
    return;
  }
  if (sms && !E164_RE.test(sms)) {
    console.error("--sms must be in E.164 format, e.g. +15551234567.");
    process.exitCode = 1;
    return;
  }

  if (otpConfig.deliveryMode !== "live") {
    console.error(
      `Refusing to run: OTP_DELIVERY_MODE is "${otpConfig.deliveryMode}", not "live".\n` +
        "This script only exercises real provider delivery — set OTP_DELIVERY_MODE=live " +
        "with full Resend/Twilio credentials first. There is no mock/dry-run mode for this script."
    );
    process.exitCode = 1;
    return;
  }
  const problems = validateLiveProviderConfig();
  if (problems.length) {
    console.error(
      "Refusing to run: live provider configuration is invalid:\n" +
        problems.map((p) => `  - ${p}`).join("\n")
    );
    process.exitCode = 1;
    return;
  }

  // Twilio trial accounts can only deliver to numbers that have been
  // explicitly verified in the Twilio console, and some destination
  // countries require local sender registration — this script cannot check
  // either of those from here, so it's surfaced as a reminder, not assumed
  // away.
  if (sms) {
    console.log(
      "Reminder: a Twilio TRIAL account can only send to numbers you've verified in the Twilio " +
        "console, and some destination countries require a registered sender ID/number. " +
        "A failure below may mean that, not a code or credential bug."
    );
  }

  let failed = false;

  if (email) {
    console.log(`\nSending ONE real test email to ${email} via Resend...`);
    const provider = new ResendEmailProvider();
    const result = await provider.sendEmail(
      email,
      "Zaio FISA — live delivery test",
      "This is a one-off delivery test sent manually via scripts/test-live-delivery.ts. " +
        "It is not a sign-in code and cannot be used to log in anywhere. No action needed.",
      "<p>This is a one-off delivery test sent manually via <code>scripts/test-live-delivery.ts</code>. " +
        "It is not a sign-in code and cannot be used to log in anywhere. No action needed.</p>"
    );
    console.log("Email result:", JSON.stringify(result));
    if (!result.ok) failed = true;
  }

  if (sms) {
    console.log(`\nSending ONE real test SMS to ${sms} via Twilio...`);
    const provider = new TwilioSmsProvider();
    const result = await provider.sendSms(
      sms,
      "Zaio FISA live delivery test. Not a sign-in code — no action needed."
    );
    console.log("SMS result:", JSON.stringify(result));
    if (!result.ok) failed = true;
  }

  console.log(
    "\nThis script wrote nothing to the database. A provider reporting ok:true means the API " +
      "accepted the message, not that it was received — check the recipient's inbox/phone " +
      "directly before concluding delivery actually works end to end."
  );

  if (failed) process.exitCode = 1;
}

main();
