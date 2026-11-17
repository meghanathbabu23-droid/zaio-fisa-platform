import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { ExamType, PracticalTestKind } from "@prisma/client";
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
});

async function loginAsStudent(email: string): Promise<string> {
  await requestOtp({ channel: OtpChannel.EMAIL, value: email });
  const code = MockEmailProvider.sent.get(email)!.code;
  const result = await verifyOtp({ channel: OtpChannel.EMAIL, value: email, code });
  if (!result.ok) throw new Error("login failed");
  return result.token;
}

describe("GET /api/student/assignments/:id/practical — question exposure", () => {
  it("includes safe question fields but never a test case's expression/isHidden (no answer-key leak)", async () => {
    const student = await createTestStudent();
    const exam = await prisma.exam.create({
      data: { title: `Question exposure exam ${Date.now()}`, type: ExamType.PRACTICAL, durationMinutes: 60 },
    });
    const question = await prisma.practicalQuestion.create({
      data: {
        examId: exam.id,
        title: "Build a signup form",
        scenario: "A client needs a signup form",
        instructions: "Create index.html with a form",
        requirements: JSON.stringify(["Has a name field"]),
        marks: 50,
        difficulty: "MEDIUM",
        sortOrder: 0,
      },
    });
    await prisma.practicalTestCase.create({
      data: {
        examId: exam.id,
        questionId: question.id,
        label: "Has h1",
        kind: PracticalTestKind.HTML_SELECTOR,
        expression: "SECRET-ANSWER-KEY-SELECTOR",
        points: 1,
        isHidden: true,
      },
    });
    const assignment = await prisma.examAssignment.create({ data: { examId: exam.id, studentId: student.id } });
    const token = await loginAsStudent(student.email);

    const res = await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.exam.questions).toHaveLength(1);
    const q = body.exam.questions[0];
    expect(q.title).toBe("Build a signup form");
    expect(q.scenario).toBe("A client needs a signup form");
    expect(q.requirements).toEqual(["Has a name field"]);
    expect(q.marks).toBe(50);
    expect(q.difficulty).toBe("MEDIUM");

    const raw = JSON.stringify(body);
    expect(raw).not.toContain("SECRET-ANSWER-KEY-SELECTOR");
    expect(raw).not.toContain("isHidden");
    expect(raw).not.toContain("expression");
  });

  it("falls back to an empty questions array for an exam with no questions (legacy/ungrouped exams keep working)", async () => {
    const student = await createTestStudent();
    const exam = await prisma.exam.create({
      data: { title: `Legacy exam ${Date.now()}`, type: ExamType.PRACTICAL, durationMinutes: 60 },
    });
    const assignment = await prisma.examAssignment.create({ data: { examId: exam.id, studentId: student.id } });
    const token = await loginAsStudent(student.email);

    const res = await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).exam.questions).toEqual([]);
  });
});
