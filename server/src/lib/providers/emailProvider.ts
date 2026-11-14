import { Resend } from "resend";
import nodemailer from "nodemailer";
import { otpConfig } from "../otpConfig.js";
import type { OtpDeliveryErrorCategory } from "./deliveryErrors.js";

export type DeliveryResult = { ok: true } | { ok: false; category: OtpDeliveryErrorCategory };

export interface EmailProvider {
  sendOtpEmail(to: string, code: string, expiresAt: Date): Promise<DeliveryResult>;
  /** Generic send, used for non-OTP admin email (e.g. password reset). */
  sendEmail(to: string, subject: string, text: string, html: string): Promise<DeliveryResult>;
}

function renderOtpEmail(code: string, expiresAt: Date) {
  const minutes = Math.round((expiresAt.getTime() - Date.now()) / 60000);
  const subject = "Your Zaio FISA sign-in code";
  const text =
    `Your Zaio FISA sign-in code is: ${code}\n\n` +
    `This code expires in ${minutes} minute${minutes === 1 ? "" : "s"}. ` +
    `If you didn't request this, you can ignore this email.`;
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #666970; margin-bottom: 4px;">Zaio FISA</p>
      <h1 style="font-family: 'Space Grotesk', Arial, sans-serif; font-size: 22px; color: #101116; margin: 0 0 16px;">Your sign-in code</h1>
      <p style="font-size: 32px; font-weight: 700; letter-spacing: 0.1em; color: #2B2ECF; margin: 0 0 16px;">${code}</p>
      <p style="font-size: 14px; color: #313339; margin: 0 0 8px;">This code expires in ${minutes} minute${minutes === 1 ? "" : "s"}.</p>
      <p style="font-size: 13px; color: #666970;">If you didn't request this, you can safely ignore this email.</p>
    </div>`;
  return { subject, text, html };
}

/**
 * Classifies a Resend error using only its structured `statusCode`/`name`
 * fields — never `.message`, which may embed the recipient address. Resend's
 * documented error names: https://resend.com/docs/api-reference/errors
 */
function classifyResendError(error: { statusCode: number | null; name: string } | undefined): OtpDeliveryErrorCategory {
  const name = error?.name ?? "";
  const status = error?.statusCode ?? null;
  // 401 is always a genuine credential failure. 403 is ambiguous on Resend:
  // it covers both a permission-scoped/restricted API key AND the sandbox
  // "no verified domain — can only send to your own account email"
  // restriction, which is a recipient problem, not a credential one.
  // `name` disambiguates — checked before the blanket 403 case below.
  if (status === 401 || name.includes("api_key") || name === "restricted_api_key") {
    return "AUTH_ERROR";
  }
  if (status === 429 || name === "rate_limit_exceeded") {
    return "RATE_LIMITED";
  }
  if (status === 403 || status === 422 || name === "validation_error" || name === "invalid_parameter" || name === "invalid_to_address") {
    return "INVALID_RECIPIENT";
  }
  return "UNKNOWN";
}

type ResendClientLike = { emails: { send: Resend["emails"]["send"] } };

export class ResendEmailProvider implements EmailProvider {
  private client: ResendClientLike;

  /** `client` param exists purely so tests can inject a stub instead of a
   * real Resend instance — never used by application code. */
  constructor(client?: ResendClientLike) {
    this.client = client ?? new Resend(otpConfig.resend.apiKey);
  }

  async sendOtpEmail(to: string, code: string, expiresAt: Date): Promise<DeliveryResult> {
    const { subject, text, html } = renderOtpEmail(code, expiresAt);
    try {
      const result = await this.client.emails.send({
        from: `${otpConfig.resend.fromName} <${otpConfig.resend.fromEmail}>`,
        to,
        subject,
        text,
        html,
      });
      if (result.error) {
        // The raw `result.error.message` (which may contain the recipient
        // address) is deliberately never read here — only the structured,
        // PII-free fields are used to classify the failure.
        return { ok: false, category: classifyResendError(result.error) };
      }
      return { ok: true };
    } catch {
      // Caught exceptions (network errors, thrown SDK errors) aren't
      // inspected for message content either — treat as NETWORK_ERROR by
      // default since a thrown (rather than returned) error from this SDK
      // is typically a transport-level failure, not an API-level rejection.
      return { ok: false, category: "NETWORK_ERROR" };
    }
  }

  async sendEmail(to: string, subject: string, text: string, html: string): Promise<DeliveryResult> {
    try {
      const result = await this.client.emails.send({
        from: `${otpConfig.resend.fromName} <${otpConfig.resend.fromEmail}>`,
        to,
        subject,
        text,
        html,
      });
      if (result.error) {
        return { ok: false, category: classifyResendError(result.error) };
      }
      return { ok: true };
    } catch {
      return { ok: false, category: "NETWORK_ERROR" };
    }
  }
}

/**
 * Classifies a Gmail SMTP (nodemailer) error using only its structured
 * `code`/`responseCode` fields — never `.message` or `.response`, either of
 * which can embed the recipient address or other SMTP conversation detail.
 */
function classifySmtpError(error: { code?: string; responseCode?: number } | undefined): OtpDeliveryErrorCategory {
  const code = error?.code ?? "";
  const responseCode = error?.responseCode ?? null;

  if (code === "EAUTH" || responseCode === 535) {
    return "AUTH_ERROR";
  }
  if (responseCode === 421 || responseCode === 450 || responseCode === 452) {
    return "RATE_LIMITED";
  }
  if (code === "EENVELOPE" || responseCode === 550 || responseCode === 551 || responseCode === 553) {
    return "INVALID_RECIPIENT";
  }
  if (code === "ECONNECTION" || code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ESOCKET" || code === "EDNS") {
    return "NETWORK_ERROR";
  }
  return "UNKNOWN";
}

type MailTransporterLike = { sendMail: (options: Record<string, unknown>) => Promise<unknown> };

/**
 * Real Gmail SMTP delivery via Nodemailer — an alternative to Resend for
 * environments where a verified sending domain isn't available yet (e.g. a
 * standalone demo). Authenticates as a real Gmail account using an App
 * Password (never the account's login password). Selected only when
 * EMAIL_PROVIDER=gmail_smtp and OTP_DELIVERY_MODE=live — see
 * providers/index.ts.
 */
export class GmailSmtpEmailProvider implements EmailProvider {
  private transporter: MailTransporterLike;

  /** `transporter` param exists purely so tests can inject a stub instead of
   * a real SMTP connection — never used by application code. */
  constructor(transporter?: MailTransporterLike) {
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: otpConfig.gmailSmtp.user, pass: otpConfig.gmailSmtp.appPassword },
      });
  }

  async sendOtpEmail(to: string, code: string, expiresAt: Date): Promise<DeliveryResult> {
    const { subject, text, html } = renderOtpEmail(code, expiresAt);
    try {
      await this.transporter.sendMail({ from: `"Zaio FISA" <${otpConfig.gmailSmtp.user}>`, to, subject, text, html });
      return { ok: true };
    } catch (err) {
      // Never inspects err.message/err.response — both can carry the
      // recipient address in SMTP reject text. Classification uses only
      // the structured code/responseCode fields nodemailer attaches.
      return { ok: false, category: classifySmtpError(err as { code?: string; responseCode?: number }) };
    }
  }

  async sendEmail(to: string, subject: string, text: string, html: string): Promise<DeliveryResult> {
    try {
      await this.transporter.sendMail({ from: `"Zaio FISA" <${otpConfig.gmailSmtp.user}>`, to, subject, text, html });
      return { ok: true };
    } catch (err) {
      return { ok: false, category: classifySmtpError(err as { code?: string; responseCode?: number }) };
    }
  }
}

/** Test/dev-only provider — never calls a real API. Captures the last code
 * sent per recipient so tests and the gated introspection endpoint can read
 * it back, without the main OTP response ever including the code. */
export class MockEmailProvider implements EmailProvider {
  static sent = new Map<string, { code: string; expiresAt: Date }>();
  /** Test-only: set to force the next send to report a failure category,
   * for exercising the delivery-failure logging/persistence path. */
  static forceFailureCategory: OtpDeliveryErrorCategory | null = null;

  async sendOtpEmail(to: string, code: string, expiresAt: Date): Promise<DeliveryResult> {
    if (MockEmailProvider.forceFailureCategory) {
      return { ok: false, category: MockEmailProvider.forceFailureCategory };
    }
    MockEmailProvider.sent.set(to, { code, expiresAt });
    return { ok: true };
  }

  static lastGenericSend: { to: string; subject: string; text: string } | null = null;

  async sendEmail(to: string, subject: string, text: string, _html: string): Promise<DeliveryResult> {
    if (MockEmailProvider.forceFailureCategory) {
      return { ok: false, category: MockEmailProvider.forceFailureCategory };
    }
    MockEmailProvider.lastGenericSend = { to, subject, text };
    return { ok: true };
  }
}
