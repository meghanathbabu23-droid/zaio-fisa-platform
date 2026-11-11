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

describe("POST /api/student/assignments/:id/practical/run-tests", () => {
  it("never creates a PracticalSubmission or PracticalAutoAssessment row, no matter how many times it's called", async () => {
    const student = await createTestStudent();
    const exam = await prisma.exam.create({
      data: {
        title: `Run-tests exam ${Date.now()}`,
        type: ExamType.PRACTICAL,
        durationMinutes: 60,
        practicalTests: {
          create: [
            { label: "Has h1", kind: PracticalTestKind.HTML_SELECTOR, targetFile: "index.html", expression: "h1", points: 1, sortOrder: 0 },
          ],
        },
      },
    });
    const assignment = await prisma.examAssignment.create({ data: { examId: exam.id, studentId: student.id } });
    const token = await loginAsStudent(student.email);
    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical/run-tests`, {
        method: "POST",
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
    }

    expect(await prisma.practicalSubmission.count({ where: { assignmentId: assignment.id } })).toBe(0);
    expect(await prisma.practicalAutoAssessment.count({ where: { assignmentId: assignment.id } })).toBe(0);
  });

  it("reflects the current (possibly failing) workspace state, not a cached/stale result", async () => {
    const student = await createTestStudent();
    const exam = await prisma.exam.create({
      data: {
        title: `Run-tests partial exam ${Date.now()}`,
        type: ExamType.PRACTICAL,
        durationMinutes: 60,
        practicalTests: {
          create: [
            { label: "Has h1", kind: PracticalTestKind.HTML_SELECTOR, targetFile: "index.html", expression: "h1", points: 1, sortOrder: 0 },
            { label: "Has nav", kind: PracticalTestKind.HTML_SELECTOR, targetFile: "index.html", expression: "nav", points: 1, sortOrder: 1 },
          ],
        },
      },
    });
    const assignment = await prisma.examAssignment.create({ data: { examId: exam.id, studentId: student.id } });
    const token = await loginAsStudent(student.email);
    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // Overwrite with a workspace that deliberately has neither <h1> nor <nav>.
    await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical/autosave`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ files: [{ filename: "index.html", content: "<p>Nothing relevant here</p>" }] }),
    });
    const firstRun = await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical/run-tests`, {
      method: "POST",
      headers: authHeaders,
    });
    const firstReport = await firstRun.json();
    expect(firstReport.earnedPoints).toBe(0);
    expect(firstReport.maxPoints).toBe(2);

    // Add just the <h1> — the report should pick up the change immediately,
    // with no caching of the earlier (failing) run.
    await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical/autosave`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ files: [{ filename: "index.html", content: "<h1>Title</h1>" }] }),
    });
    const secondRun = await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical/run-tests`, {
      method: "POST",
      headers: authHeaders,
    });
    const secondReport = await secondRun.json();
    expect(secondReport.earnedPoints).toBe(1);
    expect(secondReport.maxPoints).toBe(2);
  });

  it("returns a no-test-cases note with a zero score for an exam with no practical tests defined", async () => {
    const student = await createTestStudent();
    const exam = await prisma.exam.create({
      data: { title: `No tests exam ${Date.now()}`, type: ExamType.PRACTICAL, durationMinutes: 60 },
    });
    const assignment = await prisma.examAssignment.create({ data: { examId: exam.id, studentId: student.id } });
    const token = await loginAsStudent(student.email);

    const res = await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical/run-tests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scorePercent).toBe(0);
    expect(body.note).toMatch(/no test cases/i);
  });

  it("400s when the assignment's exam is MCQ, not PRACTICAL", async () => {
    const student = await createTestStudent();
    const exam = await prisma.exam.create({
      data: {
        title: `MCQ not practical ${Date.now()}`,
        type: ExamType.MCQ,
        durationMinutes: 30,
        questions: { create: [{ prompt: "Q", options: JSON.stringify(["a", "b"]), correctIndex: 0, sortOrder: 0 }] },
      },
    });
    const assignment = await prisma.examAssignment.create({ data: { examId: exam.id, studentId: student.id } });
    const token = await loginAsStudent(student.email);

    const res = await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical/run-tests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });

  it("401s without a student session", async () => {
    const res = await fetch(`${baseUrl}/api/student/assignments/nonexistent/practical/run-tests`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("404s for an assignment that doesn't belong to the requesting student", async () => {
    const owner = await createTestStudent();
    const other = await createTestStudent();
    const exam = await prisma.exam.create({
      data: { title: `Ownership check ${Date.now()}`, type: ExamType.PRACTICAL, durationMinutes: 60 },
    });
    const assignment = await prisma.examAssignment.create({ data: { examId: exam.id, studentId: owner.id } });
    const otherToken = await loginAsStudent(other.email);

    const res = await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical/run-tests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect(res.status).toBe(404);
  });
});
