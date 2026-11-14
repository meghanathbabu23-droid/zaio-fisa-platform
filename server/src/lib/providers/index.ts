import { otpConfig } from "../otpConfig.js";
import { type EmailProvider, ResendEmailProvider, GmailSmtpEmailProvider, MockEmailProvider } from "./emailProvider.js";
import { type SmsProvider, TwilioSmsProvider, MockSmsProvider } from "./smsProvider.js";

let emailProvider: EmailProvider | null = null;
let smsProvider: SmsProvider | null = null;

/** Mock mode always wins, regardless of EMAIL_PROVIDER. Only in live mode
 * does EMAIL_PROVIDER decide which real provider is used. */
export function getEmailProvider(): EmailProvider {
  if (!emailProvider) {
    emailProvider =
      otpConfig.deliveryMode === "mock"
        ? new MockEmailProvider()
        : otpConfig.emailProviderName === "gmail_smtp"
          ? new GmailSmtpEmailProvider()
          : new ResendEmailProvider();
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
