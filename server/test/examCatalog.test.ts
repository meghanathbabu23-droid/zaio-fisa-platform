import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { AdminRole, ExamType } from "@prisma/client";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createAndLoginTestAdmin, type AdminAuthHeaders } from "./helpers.js";
import { FISA_MCQ_TITLE, FISA_PRACTICAL_TITLE } from "../scripts/seed-fisa-assessment.js";
import { planDeactivation } from "../scripts/deactivate-legacy-exams.js";

let baseUrl: string;
let server: ReturnType<typeof app.listen>;
let superHeaders: AdminAuthHeaders;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  superHeaders = (await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN)).headers;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function createExam(overrides: Partial<{ title: string; type: ExamType; isActive: boolean }> = {}) {
  const title = overrides.title ?? `Catalog test exam ${Date.now()}-${Math.random()}`;
  const exam = await prisma.exam.create({
    data: {
      title,
      type: overrides.type ?? ExamType.PRACTICAL,
      durationMinutes: 60,
      isActive: overrides.isActive ?? true,
    },
  });
  return exam;
}

describe("Exam.isActive defaults", () => {
  it("defaults to true for a newly created exam", async () => {
    const exam = await createExam();
    expect(exam.isActive).toBe(true);
  });
});

describe("GET /api/exams?active=... filtering", () => {
  it("active=true returns only active exams", async () => {
    const active = await createExam({ isActive: true });
    const inactive = await createExam({ isActive: false });

    const res = await fetch(`${baseUrl}/api/exams?active=true`, { headers: superHeaders });
    expect(res.status).toBe(200);
    const body: { id: string; isActive: boolean }[] = await res.json();
    expect(body.every((e) => e.isActive)).toBe(true);
    expect(body.some((e) => e.id === active.id)).toBe(true);
    expect(body.some((e) => e.id === inactive.id)).toBe(false);
  });

  it("active=false returns only inactive exams", async () => {
    const inactive = await createExam({ isActive: false });
    const res = await fetch(`${baseUrl}/api/exams?active=false`, { headers: superHeaders });
    expect(res.status).toBe(200);
    const body: { id: string; isActive: boolean }[] = await res.json();
    expect(body.every((e) => !e.isActive)).toBe(true);
    expect(body.some((e) => e.id === inactive.id)).toBe(true);
  });

  it("no filter returns both active and inactive exams", async () => {
    const active = await createExam({ isActive: true });
    const inactive = await createExam({ isActive: false });
    const res = await fetch(`${baseUrl}/api/exams`, { headers: superHeaders });
    const body: { id: string }[] = await res.json();
    expect(body.some((e) => e.id === active.id)).toBe(true);
    expect(body.some((e) => e.id === inactive.id)).toBe(true);
  });
});

describe("PUT /api/exams/:id/active", () => {
  it("SUPER_ADMIN can toggle an exam's active status, and it's audit-logged", async () => {
    const exam = await createExam({ isActive: true });
    const res = await fetch(`${baseUrl}/api/exams/${exam.id}/active`, {
      method: "PUT",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isActive).toBe(false);

    const fromDb = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(fromDb.isActive).toBe(false);

    const logs = await prisma.adminAuditLog.findMany({
      where: { targetId: exam.id, action: "EXAM_ACTIVE_CHANGED" },
    });
    expect(logs.length).toBe(1);
  });

  it("deactivating does not touch the exam's questions, test cases, or existing assignments", async () => {
    const exam = await prisma.exam.create({
      data: {
        title: `Has test cases ${Date.now()}`,
        type: ExamType.MCQ,
        durationMinutes: 30,
        questions: { create: [{ prompt: "Q1", options: JSON.stringify(["a", "b"]), correctIndex: 0, sortOrder: 0 }] },
      },
      include: { questions: true },
    });
    await fetch(`${baseUrl}/api/exams/${exam.id}/active`, {
      method: "PUT",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    const fromDb = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id }, include: { questions: true } });
    expect(fromDb.questions.length).toBe(1);
  });

  it("ADMIN (not SUPER_ADMIN) cannot toggle active status", async () => {
    const exam = await createExam({ isActive: true });
    const { headers: adminHeaders } = await createAndLoginTestAdmin(AdminRole.ADMIN);
    const res = await fetch(`${baseUrl}/api/exams/${exam.id}/active`, {
      method: "PUT",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(403);
    const fromDb = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(fromDb.isActive).toBe(true);
  });

  it("rejects a non-boolean isActive value", async () => {
    const exam = await createExam();
    const res = await fetch(`${baseUrl}/api/exams/${exam.id}/active`, {
      method: "PUT",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: "yes" }),
    });
    expect(res.status).toBe(400);
  });

  it("404s for a nonexistent exam", async () => {
    const res = await fetch(`${baseUrl}/api/exams/nonexistent-id/active`, {
      method: "PUT",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(404);
  });
});

describe("scripts/deactivate-legacy-exams.ts — planDeactivation", () => {
  it("keeps the two canonical FISA exams and any Nov 14 Demo exam active; deactivates everything else", async () => {
    const canonicalMcq = await createExam({ title: FISA_MCQ_TITLE, type: ExamType.MCQ });
    const canonicalPractical = await createExam({ title: FISA_PRACTICAL_TITLE, type: ExamType.PRACTICAL });
    const nov14 = await createExam({ title: "FISA Knowledge — HTML, CSS & JavaScript (Nov 14 Demo)", type: ExamType.MCQ });
    const legacy = await createExam({ title: `Some obsolete exam ${Date.now()}`, type: ExamType.MCQ });

    const { toDeactivate, toKeepActive } = await planDeactivation();

    const keepIds = toKeepActive.map((e) => e.id);
    const deactivateIds = toDeactivate.map((e) => e.id);
    expect(keepIds).toContain(canonicalMcq.id);
    expect(keepIds).toContain(canonicalPractical.id);
    expect(keepIds).toContain(nov14.id);
    expect(deactivateIds).toContain(legacy.id);
  });
});
