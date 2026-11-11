import { describe, it, expect, beforeEach } from "vitest";
import { ResendEmailProvider, MockEmailProvider } from "../src/lib/providers/emailProvider.js";
import { TwilioSmsProvider, MockSmsProvider } from "../src/lib/providers/smsProvider.js";
import { getEmailProvider, getSmsProvider } from "../src/lib/providers/index.js";

beforeEach(() => {
  MockEmailProvider.sent.clear();
  MockSmsProvider.sent.clear();
});

describe("provider factory", () => {
  it("returns the mock providers when OTP_DELIVERY_MODE=mock (set for the whole test run)", () => {
    expect(getEmailProvider()).toBeInstanceOf(MockEmailProvider);
    expect(getSmsProvider()).toBeInstanceOf(MockSmsProvider);
  });
});

describe("MockEmailProvider / MockSmsProvider", () => {
  it("captures the code and expiry per recipient, never calling a real API", async () => {
    const provider = new MockEmailProvider();
    const expiresAt = new Date(Date.now() + 60_000);
    const result = await provider.sendOtpEmail("a@example.com", "111222", expiresAt);
    expect(result.ok).toBe(true);
    expect(MockEmailProvider.sent.get("a@example.com")).toEqual({ code: "111222", expiresAt });
  });

  it("a later send for the same recipient overwrites the earlier capture", async () => {
    const provider = new MockSmsProvider();
    await provider.sendOtpSms("+27821110000", "111111", new Date());
    await provider.sendOtpSms("+27821110000", "222222", new Date());
    expect(MockSmsProvider.sent.get("+27821110000")?.code).toBe("222222");
  });
});

describe("ResendEmailProvider — classification via injected stub (no network call, no raw message returned)", () => {
  it("returns ok:true when the stubbed client reports no error", async () => {
    const stub = { emails: { send: async () => ({ data: { id: "stub-id" }, error: null }) } } as any;
    const provider = new ResendEmailProvider(stub);
    const result = await provider.sendOtpEmail("to@example.com", "123456", new Date(Date.now() + 60_000));
    expect(result).toEqual({ ok: true });
  });

  it("classifies a 401/api-key error as AUTH_ERROR, without exposing the raw message", async () => {
    const stub = {
      emails: { send: async () => ({ data: null, error: { message: "Invalid API key: re_super_secret_value", name: "invalid_api_key", statusCode: 401 } }) },
    } as any;
    const provider = new ResendEmailProvider(stub);
    const result = await provider.sendOtpEmail("to@example.com", "123456", new Date(Date.now() + 60_000));
    expect(result).toEqual({ ok: false, category: "AUTH_ERROR" });
    expect(JSON.stringify(result)).not.toContain("re_super_secret_value");
  });

  it("classifies a 422 validation error as INVALID_RECIPIENT, without exposing the recipient address", async () => {
    const stub = {
      emails: { send: async () => ({ data: null, error: { message: "Invalid 'to' address: someone@example.com", name: "validation_error", statusCode: 422 } }) },
    } as any;
    const provider = new ResendEmailProvider(stub);
    const result = await provider.sendOtpEmail("someone@example.com", "123456", new Date(Date.now() + 60_000));
    expect(result).toEqual({ ok: false, category: "INVALID_RECIPIENT" });
    expect(JSON.stringify(result)).not.toContain("someone@example.com");
  });

  it("classifies a 429 as RATE_LIMITED", async () => {
    const stub = {
      emails: { send: async () => ({ data: null, error: { message: "too many requests", name: "rate_limit_exceeded", statusCode: 429 } }) },
    } as any;
    const provider = new ResendEmailProvider(stub);
    const result = await provider.sendOtpEmail("to@example.com", "123456", new Date(Date.now() + 60_000));
    expect(result).toEqual({ ok: false, category: "RATE_LIMITED" });
  });

  it("an unrecognized error shape classifies as UNKNOWN, not a throw", async () => {
    const stub = {
      emails: { send: async () => ({ data: null, error: { message: "something odd", name: "something_else", statusCode: 500 } }) },
    } as any;
    const provider = new ResendEmailProvider(stub);
    const result = await provider.sendOtpEmail("to@example.com", "123456", new Date(Date.now() + 60_000));
    expect(result).toEqual({ ok: false, category: "UNKNOWN" });
  });

  it("a thrown exception (network-level) classifies as NETWORK_ERROR, without exposing the exception message", async () => {
    const stub = { emails: { send: async () => { throw new Error("getaddrinfo ENOTFOUND api.resend.com"); } } } as any;
    const provider = new ResendEmailProvider(stub);
    const result = await provider.sendOtpEmail("to@example.com", "123456", new Date(Date.now() + 60_000));
    expect(result).toEqual({ ok: false, category: "NETWORK_ERROR" });
  });

  it("sendEmail (generic, non-OTP send used by password reset and the live-delivery test script) uses the same classification path", async () => {
    const okStub = { emails: { send: async () => ({ data: { id: "stub-id" }, error: null }) } } as any;
    const ok = await new ResendEmailProvider(okStub).sendEmail("to@example.com", "Subject", "text body", "<p>html</p>");
    expect(ok).toEqual({ ok: true });

    const failStub = {
      emails: { send: async () => ({ data: null, error: { message: "Invalid API key: re_secret", name: "invalid_api_key", statusCode: 401 } }) },
    } as any;
    const failed = await new ResendEmailProvider(failStub).sendEmail("to@example.com", "Subject", "text body", "<p>html</p>");
    expect(failed).toEqual({ ok: false, category: "AUTH_ERROR" });
    expect(JSON.stringify(failed)).not.toContain("re_secret");
  });
});

describe("TwilioSmsProvider — classification via injected stub (no network call, no raw message returned)", () => {
  it("returns ok:true when the stubbed client resolves", async () => {
    const stub = { messages: { create: async () => ({ sid: "SMstub" }) } } as any;
    const provider = new TwilioSmsProvider(stub);
    const result = await provider.sendOtpSms("+27821110000", "123456", new Date(Date.now() + 60_000));
    expect(result).toEqual({ ok: true });
  });

  it("classifies Twilio code 21211 (invalid 'To' number) as INVALID_RECIPIENT, without exposing the number", async () => {
    const stub = {
      messages: {
        create: async () => {
          throw Object.assign(new Error("The 'To' number +27821110000 is not a valid phone number."), { code: 21211, status: 400 });
        },
      },
    } as any;
    const provider = new TwilioSmsProvider(stub);
    const result = await provider.sendOtpSms("+27821110000", "123456", new Date(Date.now() + 60_000));
    expect(result).toEqual({ ok: false, category: "INVALID_RECIPIENT" });
    expect(JSON.stringify(result)).not.toContain("+27821110000");
  });

  it("classifies Twilio code 20003 (authentication error) as AUTH_ERROR", async () => {
    const stub = {
      messages: { create: async () => { throw Object.assign(new Error("Authenticate"), { code: 20003, status: 401 }); } },
    } as any;
    const provider = new TwilioSmsProvider(stub);
    const result = await provider.sendOtpSms("+27821110000", "123456", new Date(Date.now() + 60_000));
    expect(result).toEqual({ ok: false, category: "AUTH_ERROR" });
  });

  it("classifies Twilio code 20429 (too many requests) as RATE_LIMITED", async () => {
    const stub = {
      messages: { create: async () => { throw Object.assign(new Error("Too many requests"), { code: 20429, status: 429 }); } },
    } as any;
    const provider = new TwilioSmsProvider(stub);
    const result = await provider.sendOtpSms("+27821110000", "123456", new Date(Date.now() + 60_000));
    expect(result).toEqual({ ok: false, category: "RATE_LIMITED" });
  });

  it("an unrecognized Twilio error code classifies as UNKNOWN, not a throw", async () => {
    const stub = {
      messages: { create: async () => { throw Object.assign(new Error("Something else"), { code: 99999, status: 500 }); } },
    } as any;
    const provider = new TwilioSmsProvider(stub);
    const result = await provider.sendOtpSms("+27821110000", "123456", new Date(Date.now() + 60_000));
    expect(result).toEqual({ ok: false, category: "UNKNOWN" });
  });

  it("sendSms (generic, non-OTP send used only by the live-delivery test script) uses the same classification path", async () => {
    const okStub = { messages: { create: async () => ({ sid: "SMstub" }) } } as any;
    const ok = await new TwilioSmsProvider(okStub).sendSms("+27821110000", "test body");
    expect(ok).toEqual({ ok: true });

    const failStub = {
      messages: { create: async () => { throw Object.assign(new Error("Authenticate"), { code: 20003, status: 401 }); } },
    } as any;
    const failed = await new TwilioSmsProvider(failStub).sendSms("+27821110000", "test body");
    expect(failed).toEqual({ ok: false, category: "AUTH_ERROR" });
  });
});
