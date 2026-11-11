import twilio from "twilio";
import { otpConfig } from "../otpConfig.js";
import type { OtpDeliveryErrorCategory } from "./deliveryErrors.js";
import type { DeliveryResult } from "./emailProvider.js";

export interface SmsProvider {
  sendOtpSms(to: string, code: string, expiresAt: Date): Promise<DeliveryResult>;
  /** Generic send, used only by scripts/test-live-delivery.ts — never part
   * of the OTP login flow itself. */
  sendSms(to: string, body: string): Promise<DeliveryResult>;
}

function renderOtpSms(code: string, expiresAt: Date): string {
  const minutes = Math.round((expiresAt.getTime() - Date.now()) / 60000);
  return `Zaio FISA sign-in code: ${code}. Expires in ${minutes} minute${minutes === 1 ? "" : "s"}. If you didn't request this, ignore this message.`;
}

/**
 * Classifies a Twilio error using only its structured `.code`/`.status`
 * fields — never `.message`, which may embed the recipient number. Common
 * Twilio error codes: https://www.twilio.com/docs/api/errors
 */
function classifyTwilioError(error: { code?: number; status?: number } | undefined): OtpDeliveryErrorCategory {
  const code = error?.code;
  const status = error?.status;
  if (status === 401 || code === 20003 || code === 20005) {
    return "AUTH_ERROR";
  }
  if (status === 429 || code === 20429 || code === 20022) {
    return "RATE_LIMITED";
  }
  // 21211 invalid 'To', 21614 not SMS-capable, 21408 permission/geo, 21610 unsubscribed
  if (code === 21211 || code === 21614 || code === 21408 || code === 21610) {
    return "INVALID_RECIPIENT";
  }
  return "UNKNOWN";
}

type TwilioClientLike = { messages: { create: ReturnType<typeof twilio>["messages"]["create"] } };

/** Plain Twilio SMS send — deliberately not Twilio Verify, per the approved
 * architecture: one unified OTP model in our own DB for both channels. */
export class TwilioSmsProvider implements SmsProvider {
  private client: TwilioClientLike;

  /** `client` param exists purely so tests can inject a stub instead of a
   * real Twilio instance — never used by application code. */
  constructor(client?: TwilioClientLike) {
    this.client = client ?? twilio(otpConfig.twilio.accountSid, otpConfig.twilio.authToken);
  }

  async sendOtpSms(to: string, code: string, expiresAt: Date): Promise<DeliveryResult> {
    try {
      await this.client.messages.create({
        to,
        from: otpConfig.twilio.fromNumber,
        body: renderOtpSms(code, expiresAt),
      });
      return { ok: true };
    } catch (e) {
      // Twilio's RestException carries structured `.code`/`.status` fields
      // alongside `.message` — only the structured fields are read here.
      // `.message` (which may contain the recipient number) is never
      // inspected, logged, or returned.
      const structured = e as { code?: number; status?: number } | undefined;
      return { ok: false, category: classifyTwilioError(structured) };
    }
  }

  async sendSms(to: string, body: string): Promise<DeliveryResult> {
    try {
      await this.client.messages.create({ to, from: otpConfig.twilio.fromNumber, body });
      return { ok: true };
    } catch (e) {
      const structured = e as { code?: number; status?: number } | undefined;
      return { ok: false, category: classifyTwilioError(structured) };
    }
  }
}

/** Test/dev-only provider — never calls Twilio. Captures the last code sent
 * per recipient for tests and the gated introspection endpoint. */
export class MockSmsProvider implements SmsProvider {
  static sent = new Map<string, { code: string; expiresAt: Date }>();
  /** Test-only: set to force the next send to report a failure category,
   * for exercising the delivery-failure logging/persistence path. */
  static forceFailureCategory: OtpDeliveryErrorCategory | null = null;

  async sendOtpSms(to: string, code: string, expiresAt: Date): Promise<DeliveryResult> {
    if (MockSmsProvider.forceFailureCategory) {
      return { ok: false, category: MockSmsProvider.forceFailureCategory };
    }
    MockSmsProvider.sent.set(to, { code, expiresAt });
    return { ok: true };
  }

  static lastGenericSend: { to: string; body: string } | null = null;

  async sendSms(to: string, body: string): Promise<DeliveryResult> {
    if (MockSmsProvider.forceFailureCategory) {
      return { ok: false, category: MockSmsProvider.forceFailureCategory };
    }
    MockSmsProvider.lastGenericSend = { to, body };
    return { ok: true };
  }
}
