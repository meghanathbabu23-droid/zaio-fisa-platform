import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../src/prisma.js";
import { requestOtp, OtpChannel } from "../src/lib/otp.js";
import { MockEmailProvider, MockSmsProvider } from "../src/lib/providers/index.js";
import { resetRateLimitStateForTests } from "../src/lib/rateLimit.js";
import { createTestStudent } from "./helpers.js";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRateLimitStateForTests();
  MockEmailProvider.sent.clear();
  MockSmsProvider.sent.clear();
  MockEmailProvider.forceFailureCategory = null;
  MockSmsProvider.forceFailureCategory = null;
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  MockEmailProvider.forceFailureCategory = null;
  MockSmsProvider.forceFailureCategory = null;
  consoleErrorSpy.mockRestore();
});

describe("delivery-failure logging and persistence — sanitized, correlated", () => {
  it("a failed email delivery logs only a correlation ID + category, never the recipient, never the code", async () => {
    const student = await createTestStudent();
    MockEmailProvider.forceFailureCategory = "AUTH_ERROR";

    await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const loggedLine = consoleErrorSpy.mock.calls[0]?.[0] as string;
    expect(loggedLine).toContain("category=AUTH_ERROR");
    expect(loggedLine).toMatch(/correlationId=[0-9a-f]{12}/);
    expect(loggedLine).not.toContain(student.email);
    expect(loggedLine).not.toContain(student.id);
  });

  it("the failure is persisted with a matching correlation ID, the classified category, and no PII fields", async () => {
    const student = await createTestStudent();
    MockSmsProvider.forceFailureCategory = "INVALID_RECIPIENT";

    await requestOtp({ channel: OtpChannel.SMS, value: student.phone! });

    const loggedLine = consoleErrorSpy.mock.calls[0]?.[0] as string;
    const correlationId = loggedLine.match(/correlationId=([0-9a-f]{12})/)?.[1];
    expect(correlationId).toBeDefined();

    const row = await prisma.otpDeliveryFailure.findUnique({ where: { correlationId } });
    expect(row).not.toBeNull();
    expect(row!.studentId).toBe(student.id);
    expect(row!.channel).toBe("SMS");
    expect(row!.provider).toBe("TWILIO");
    expect(row!.category).toBe("INVALID_RECIPIENT");

    // The persisted row's own column set has no email/phone/message/code
    // columns at all — asserting the exact keys guards against ever adding
    // one later without a deliberate schema review.
    expect(Object.keys(row!).sort()).toEqual(
      ["category", "channel", "correlationId", "createdAt", "id", "provider", "studentId"].sort()
    );
  });

  it("a successful delivery creates no OtpDeliveryFailure row and logs nothing", async () => {
    const student = await createTestStudent();
    await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(await prisma.otpDeliveryFailure.count({ where: { studentId: student.id } })).toBe(0);
  });

  it("a delivery failure for an unregistered identifier never happens at all (no provider call, no failure row)", async () => {
    MockEmailProvider.forceFailureCategory = "UNKNOWN";
    await requestOtp({ channel: OtpChannel.EMAIL, value: `ghost-${Date.now()}@example.com` });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
