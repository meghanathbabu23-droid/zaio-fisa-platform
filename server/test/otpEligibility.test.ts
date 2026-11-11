import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../src/prisma.js";
import { requestOtp, OtpChannel, isEligibleForRealDelivery } from "../src/lib/otp.js";
import { otpConfig } from "../src/lib/otpConfig.js";
import { MockEmailProvider, MockSmsProvider } from "../src/lib/providers/index.js";
import { resetRateLimitStateForTests } from "../src/lib/rateLimit.js";
import { createTestStudent } from "./helpers.js";

const originalMode = otpConfig.deliveryMode;

beforeEach(() => {
  resetRateLimitStateForTests();
  MockEmailProvider.sent.clear();
  MockSmsProvider.sent.clear();
});

afterEach(() => {
  otpConfig.deliveryMode = originalMode;
});

describe("isEligibleForRealDelivery — pure gate logic, no network/DB", () => {
  it("false when global mode is mock, regardless of cohort eligibility", () => {
    expect(isEligibleForRealDelivery({ cohort: { realOtpEligible: true } })).toBe(false);
  });

  it("false when global mode is live but the cohort is not eligible", () => {
    otpConfig.deliveryMode = "live";
    expect(isEligibleForRealDelivery({ cohort: { realOtpEligible: false } })).toBe(false);
  });

  it("true only when BOTH global mode is live AND the cohort is eligible", () => {
    otpConfig.deliveryMode = "live";
    expect(isEligibleForRealDelivery({ cohort: { realOtpEligible: true } })).toBe(true);
  });
});

describe("requestOtp — cohort eligibility gate (integration, mock-reachable branches only)", () => {
  // Deliberately not testing the "global live + cohort eligible" branch here
  // via a full requestOtp() call: that branch calls the real Resend/Twilio
  // SDK, and even a call expected to fail due to bad test credentials would
  // be a genuine attempt at a network request to a real provider — which
  // this task explicitly prohibits during testing. That branch is covered
  // by the pure isEligibleForRealDelivery unit test above instead.

  it("global mock mode: a student in an eligible cohort still goes through the mock provider", async () => {
    const student = await createTestStudent();
    await prisma.cohort.update({ where: { id: student.cohortId }, data: { realOtpEligible: true } });
    await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });
    expect(MockEmailProvider.sent.has(student.email)).toBe(true);
  });

  it("global live mode + cohort NOT eligible: falls through to the mock provider, never attempts a real send", async () => {
    const student = await createTestStudent(); // cohort defaults to realOtpEligible: false
    otpConfig.deliveryMode = "live";
    await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });
    expect(MockEmailProvider.sent.has(student.email)).toBe(true);
  });

  it("the SMS channel respects the same gate", async () => {
    const student = await createTestStudent({ phone: "+27821119101" });
    otpConfig.deliveryMode = "live";
    await requestOtp({ channel: OtpChannel.SMS, value: student.phone! });
    expect(MockSmsProvider.sent.has(student.phone!)).toBe(true);
  });
});

describe("Enabling cohort eligibility is not the same as contact-detail verification", () => {
  it("toggling realOtpEligible does not set emailVerifiedAt or phoneVerifiedAt on any student in the cohort", async () => {
    const student = await createTestStudent();
    await prisma.cohort.update({ where: { id: student.cohortId }, data: { realOtpEligible: true } });
    const updated = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(updated.emailVerifiedAt).toBeNull();
    expect(updated.phoneVerifiedAt).toBeNull();
  });

  it("new cohorts default to realOtpEligible: false", async () => {
    const student = await createTestStudent();
    const cohort = await prisma.cohort.findUniqueOrThrow({ where: { id: student.cohortId } });
    expect(cohort.realOtpEligible).toBe(false);
  });
});
