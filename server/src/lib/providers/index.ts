import { otpConfig } from "../otpConfig.js";
import { type EmailProvider, ResendEmailProvider, MockEmailProvider } from "./emailProvider.js";
import { type SmsProvider, TwilioSmsProvider, MockSmsProvider } from "./smsProvider.js";

let emailProvider: EmailProvider | null = null;
let smsProvider: SmsProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (!emailProvider) {
    emailProvider = otpConfig.deliveryMode === "mock" ? new MockEmailProvider() : new ResendEmailProvider();
  }
  return emailProvider;
}

export function getSmsProvider(): SmsProvider {
  if (!smsProvider) {
    smsProvider = otpConfig.deliveryMode === "mock" ? new MockSmsProvider() : new TwilioSmsProvider();
  }
  return smsProvider;
}

export { MockEmailProvider, MockSmsProvider };
export type { EmailProvider, SmsProvider };
