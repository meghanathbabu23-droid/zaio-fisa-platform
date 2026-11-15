import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { Prisma, ExamType } from "@prisma/client";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createTestStudent } from "./helpers.js";
import { OtpChannel, requestOtp, verifyOtp } from "../src/lib/otp.js";
import { MockEmailProvider } from "../src/lib/providers/index.js";

let baseUrl: string;
let server: ReturnType<typeof app.listen>;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  vi.restoreAllMocks();
});

async function loginAsStudent(email: string): Promise<string> {
  await requestOtp({ channel: OtpChannel.EMAIL, value: email });
  const code = MockEmailProvider.sent.get(email)!.code;
  const result = await verifyOtp({ channel: OtpChannel.EMAIL, value: email, code });
  if (!result.ok) throw new Error("login failed");
  return result.token;
}

describe("PUT practical autosave — Mongo-style write conflicts must not crash the process", () => {
  it("returns 503 retryable JSON when write conflicts persist after retries (Heroku regression)", async () => {
    const student = await createTestStudent();
    const exam = await prisma.exam.create({
      data: { title: `Conflict autosave ${Date.now()}`, type: ExamType.PRACTICAL, durationMinutes: 60 },
    });
    const assignment = await prisma.examAssignment.create({ data: { examId: exam.id, studentId: student.id } });
    const token = await loginAsStudent(student.email);

    await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const conflict = new Prisma.PrismaClientKnownRequestError("write conflict", {
      code: "P2034",
      clientVersion: "test",
    });
    const txSpy = vi.spyOn(prisma, "$transaction").mockRejectedValue(conflict);

    const res = await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical/autosave`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ filename: "index.html", content: "<h1>x</h1>" }] }),
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Temporary database conflict — please retry in a moment",
      retryable: true,
    });
    expect(txSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});