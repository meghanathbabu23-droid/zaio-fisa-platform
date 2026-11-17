import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { AdminRole, ExamType } from "@prisma/client";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createAndLoginTestAdmin, createTestStudent } from "./helpers.js";

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

async function createPracticalExam(totalMarks: number | null = 100) {
  return prisma.exam.create({
    data: {
      title: `Practical Qs exam ${Date.now()}-${Math.random()}`,
      type: ExamType.PRACTICAL,
      durationMinutes: 60,
      totalMarks,
    },
  });
}

function fakePdf(): string {
  return Buffer.from("%PDF-1.4\n%%fake minimal pdf for tests%%\n%%EOF").toString("base64");
}

function fakePng(): string {
  // Valid PNG magic bytes followed by arbitrary padding — enough for the
  // sniffer, this test never actually decodes it as an image.
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([header, Buffer.from("padding-bytes-not-a-real-png")]).toString("base64");
}

describe("Practical questions — CRUD, marks, immutability, RBAC", () => {
  it("SUPER_ADMIN can create, list, update and delete a question; ADMIN can only read", async () => {
    const exam = await createPracticalExam();
    const { headers: superHeaders } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);
    const { headers: adminHeaders } = await createAndLoginTestAdmin(AdminRole.ADMIN);

    const createAsAdmin = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Should fail", marks: 10 }),
    });
    expect(createAsAdmin.status).toBe(403);

    const createRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, {
      method: "POST",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Build a signup form",
        scenario: "A client needs a signup form",
        instructions: "Create index.html with a form",
        requirements: ["Has a name field", "Has an email field"],
        marks: 60,
        difficulty: "MEDIUM",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.title).toBe("Build a signup form");
    expect(created.requirements).toEqual(["Has a name field", "Has an email field"]);
    expect(created.testCaseCount).toBe(0);

    const listAsAdmin = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, { headers: adminHeaders });
    expect(listAsAdmin.status).toBe(200);
    const list = await listAsAdmin.json();
    expect(list).toHaveLength(1);

    const updateAsAdmin = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions/${created.id}`, {
      method: "PUT",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Nope", marks: 10 }),
    });
    expect(updateAsAdmin.status).toBe(403);

    const updateRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions/${created.id}`, {
      method: "PUT",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Build a login form", marks: 60, requirements: [] }),
    });
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()).title).toBe("Build a login form");

    const deleteAsAdmin = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions/${created.id}`, {
      method: "DELETE",
      headers: adminHeaders,
    });
    expect(deleteAsAdmin.status).toBe(403);

    const deleteRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions/${created.id}`, {
      method: "DELETE",
      headers: superHeaders,
    });
    expect(deleteRes.status).toBe(204);
  });

  it("rejects a question with no title, negative marks, or an invalid difficulty", async () => {
    const exam = await createPracticalExam();
    const { headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);

    const noTitle = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "   ", marks: 10 }),
    });
    expect(noTitle.status).toBe(400);

    const negativeMarks = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Valid title", marks: -5 }),
    });
    expect(negativeMarks.status).toBe(400);

    const badDifficulty = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Valid title", marks: 10, difficulty: "IMPOSSIBLE" }),
    });
    expect(badDifficulty.status).toBe(400);
  });

  it("locks question create/update/delete/reorder once the exam has any student assignment", async () => {
    const exam = await createPracticalExam();
    const student = await createTestStudent();
    const { headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);

    const createRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Question A", marks: 50 }),
    });
    const question = await createRes.json();

    await prisma.examAssignment.create({ data: { examId: exam.id, studentId: student.id } });

    const createAfterAssignment = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Question B", marks: 50 }),
    });
    expect(createAfterAssignment.status).toBe(409);

    const updateAfterAssignment = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions/${question.id}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Changed", marks: 50 }),
    });
    expect(updateAfterAssignment.status).toBe(409);

    const reorderAfterAssignment = await fetch(
      `${baseUrl}/api/exams/${exam.id}/practical-questions/${question.id}/reorder`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ direction: "up" }),
      }
    );
    expect(reorderAfterAssignment.status).toBe(409);

    const deleteAfterAssignment = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions/${question.id}`, {
      method: "DELETE",
      headers,
    });
    expect(deleteAfterAssignment.status).toBe(409);
  });

  it("reorders by swapping sortOrder with the adjacent sibling", async () => {
    const exam = await createPracticalExam();
    const { headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);

    const titles = ["First", "Second", "Third"];
    const ids: string[] = [];
    for (const title of titles) {
      const res = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ title, marks: 10 }),
      });
      ids.push((await res.json()).id);
    }

    await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions/${ids[2]}/reorder`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ direction: "up" }),
    });

    const listRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, { headers });
    const list = await listRes.json();
    expect(list.map((q: { title: string }) => q.title)).toEqual(["First", "Third", "Second"]);

    const noopRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions/${ids[0]}/reorder`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ direction: "up" }),
    });
    expect((await noopRes.json()).moved).toBe(false);
  });
});

describe("Practical test cases linked to questions", () => {
  it("accepts a questionId belonging to the same exam, rejects one from a different exam", async () => {
    const examA = await createPracticalExam();
    const examB = await createPracticalExam();
    const { headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);

    const qRes = await fetch(`${baseUrl}/api/exams/${examA.id}/practical-questions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Q1", marks: 10 }),
    });
    const question = await qRes.json();

    const goodCase = await fetch(`${baseUrl}/api/exams/${examA.id}/practical-tests`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Has h1",
        kind: "HTML_SELECTOR",
        expression: "h1",
        points: 1,
        questionId: question.id,
      }),
    });
    expect(goodCase.status).toBe(201);
    expect((await goodCase.json()).questionId).toBe(question.id);

    const crossExamCase = await fetch(`${baseUrl}/api/exams/${examB.id}/practical-tests`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Has h1",
        kind: "HTML_SELECTOR",
        expression: "h1",
        points: 1,
        questionId: question.id,
      }),
    });
    expect(crossExamCase.status).toBe(400);
  });

  it("un-links (does not delete) test cases when their question is deleted", async () => {
    const exam = await createPracticalExam();
    const { headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);

    const qRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Q1", marks: 10 }),
    });
    const question = await qRes.json();

    const caseRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-tests`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Has h1",
        kind: "HTML_SELECTOR",
        expression: "h1",
        points: 1,
        questionId: question.id,
      }),
    });
    const testCase = await caseRes.json();

    const deleteRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions/${question.id}`, {
      method: "DELETE",
      headers,
    });
    expect(deleteRes.status).toBe(204);

    const stillExists = await prisma.practicalTestCase.findUnique({ where: { id: testCase.id } });
    expect(stillExists).not.toBeNull();
    expect(stillExists?.questionId).toBeNull();
  });
});

describe("Practical question reference assets", () => {
  it("uploads an image and a PDF, lists them, streams one, and deletes one", async () => {
    const exam = await createPracticalExam();
    const { headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);
    const qRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Q1", marks: 10 }),
    });
    const question = await qRes.json();
    const assetsUrl = `${baseUrl}/api/exams/${exam.id}/practical-questions/${question.id}/assets`;

    const uploadPdf = await fetch(assetsUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "brief.pdf", dataBase64: fakePdf() }),
    });
    expect(uploadPdf.status).toBe(201);
    expect((await uploadPdf.json()).mimeType).toBe("application/pdf");

    const uploadPng = await fetch(assetsUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "mockup.png", dataBase64: fakePng() }),
    });
    expect(uploadPng.status).toBe(201);

    const listRes = await fetch(assetsUrl, { headers });
    const list = await listRes.json();
    expect(list.map((a: { filename: string }) => a.filename).sort()).toEqual(["brief.pdf", "mockup.png"]);

    const streamRes = await fetch(`${assetsUrl}/brief.pdf`, { headers });
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toBe("application/pdf");

    const deleteRes = await fetch(`${assetsUrl}/brief.pdf`, { method: "DELETE", headers });
    expect(deleteRes.status).toBe(204);

    const listAfterDelete = await fetch(assetsUrl, { headers });
    expect((await listAfterDelete.json()).map((a: { filename: string }) => a.filename)).toEqual(["mockup.png"]);
  });

  it("rejects a filename whose content doesn't match a supported type, and an unsupported extension", async () => {
    const exam = await createPracticalExam();
    const { headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);
    const qRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Q1", marks: 10 }),
    });
    const question = await qRes.json();
    const assetsUrl = `${baseUrl}/api/exams/${exam.id}/practical-questions/${question.id}/assets`;

    const badExtension = await fetch(assetsUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "script.svg", dataBase64: fakePng() }),
    });
    expect(badExtension.status).toBe(400);

    const mismatchedContent = await fetch(assetsUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "fake.pdf", dataBase64: Buffer.from("not a pdf at all").toString("base64") }),
    });
    expect(mismatchedContent.status).toBe(400);
  });

  it("asset routes work even once the exam has a student assignment (reference material isn't graded content)", async () => {
    const exam = await createPracticalExam();
    const student = await createTestStudent();
    const { headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);
    const qRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Q1", marks: 10 }),
    });
    const question = await qRes.json();
    await prisma.examAssignment.create({ data: { examId: exam.id, studentId: student.id } });

    const uploadRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions/${question.id}/assets`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "brief.pdf", dataBase64: fakePdf() }),
    });
    expect(uploadRes.status).toBe(201);
  });

  it("deleting a question purges its reference asset storage along with the DB rows", async () => {
    const exam = await createPracticalExam();
    const { headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);
    const qRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Q1", marks: 10 }),
    });
    const question = await qRes.json();
    await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions/${question.id}/assets`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "brief.pdf", dataBase64: fakePdf() }),
    });

    const deleteRes = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-questions/${question.id}`, {
      method: "DELETE",
      headers,
    });
    expect(deleteRes.status).toBe(204);

    const assetRows = await prisma.practicalQuestionReferenceAsset.findMany({ where: { questionId: question.id } });
    expect(assetRows).toHaveLength(0);
  });
});
