import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/prisma.js";
import { requestOtp, verifyOtp, OtpChannel } from "../src/lib/otp.js";
import { MockEmailProvider } from "../src/lib/providers/index.js";
import { resetRateLimitStateForTests } from "../src/lib/rateLimit.js";
import { createTestStudent } from "./helpers.js";

beforeEach(() => {
  resetRateLimitStateForTests();
  MockEmailProvider.sent.clear();
});

async function loginOnce(email: string) {
  // Reset the resend-cooldown/identifier limiter before each call so that
  // logging in twice in one test (to exercise session revocation) isn't
  // itself blocked by the cooldown — that's covered separately in
  // rateLimit.test.ts and httpAuth.test.ts's dedicated cooldown test.
  resetRateLimitStateForTests();
  await requestOtp({ channel: OtpChannel.EMAIL, value: email });
  const code = MockEmailProvider.sent.get(email)!.code;
  const result = await verifyOtp({ channel: OtpChannel.EMAIL, value: email, code });
  if (!result.ok) throw new Error("expected login to succeed");
  return result.token;
}

describe("session revocation on new verify", () => {
  it("a successful login revokes every other active session for that student", async () => {
    const student = await createTestStudent();
    const firstToken = await loginOnce(student.email);

    const sessionsAfterFirst = await prisma.studentSession.findMany({ where: { studentId: student.id } });
    expect(sessionsAfterFirst).toHaveLength(1);

    const secondToken = await loginOnce(student.email);

    const sessionsAfterSecond = await prisma.studentSession.findMany({ where: { studentId: student.id } });
    expect(sessionsAfterSecond).toHaveLength(1);
    expect(sessionsAfterSecond[0].token).toBe(secondToken);
    expect(sessionsAfterSecond[0].token).not.toBe(firstToken);
  });

  it("the old token no longer resolves to a session after a new login", async () => {
    const student = await createTestStudent();
    const firstToken = await loginOnce(student.email);
    await loginOnce(student.email);

    const stale = await prisma.studentSession.findUnique({ where: { token: firstToken } });
    expect(stale).toBeNull();
  });

  it("the new token does resolve to a valid, unexpired session", async () => {
    const student = await createTestStudent();
    await loginOnce(student.email);
    const secondToken = await loginOnce(student.email);

    const session = await prisma.studentSession.findUnique({ where: { token: secondToken } });
    expect(session).not.toBeNull();
    expect(session!.studentId).toBe(student.id);
    expect(session!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("logging in as a different student doesn't touch the first student's session", async () => {
    const studentA = await createTestStudent();
    const studentB = await createTestStudent();
    const tokenA = await loginOnce(studentA.email);
    await loginOnce(studentB.email);

    const sessionA = await prisma.studentSession.findUnique({ where: { token: tokenA } });
    expect(sessionA).not.toBeNull();
  });
});

describe("admin: revoke-sessions capability", () => {
  it("deleting all sessions for a student via deleteMany leaves none behind", async () => {
    const student = await createTestStudent();
    await loginOnce(student.email);
    expect(await prisma.studentSession.count({ where: { studentId: student.id } })).toBe(1);

    await prisma.studentSession.deleteMany({ where: { studentId: student.id } });
    expect(await prisma.studentSession.count({ where: { studentId: student.id } })).toBe(0);
  });
});
