import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { AdminRole } from "@prisma/client";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createTestCohort, createAndLoginTestAdmin, type AdminAuthHeaders } from "./helpers.js";

let baseUrl: string;
let server: ReturnType<typeof app.listen>;
let adminHeaders: AdminAuthHeaders;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  adminHeaders = (await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN)).headers;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function putJson(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe("POST /api/students — phone normalization on create", () => {
  it("normalizes a locally-formatted South African number to E.164", async () => {
    const cohort = await createTestCohort();
    const { status, body } = await postJson("/api/students", {
      firstName: "Nomsa",
      lastName: "Test",
      email: `nomsa.${Date.now()}@example.com`,
      phone: "082 111 9999",
      cohortId: cohort.id,
    });
    expect(status).toBe(201);
    expect(body.phone).toBe("+27821119999");
  });

  it("accepts an already-E.164 number unchanged", async () => {
    const cohort = await createTestCohort();
    const { status, body } = await postJson("/api/students", {
      firstName: "Already",
      lastName: "E164",
      email: `already.${Date.now()}@example.com`,
      phone: "+27821119998",
      cohortId: cohort.id,
    });
    expect(status).toBe(201);
    expect(body.phone).toBe("+27821119998");
  });

  it("rejects an invalid phone number with a validation error, not a 500", async () => {
    const cohort = await createTestCohort();
    const { status, body } = await postJson("/api/students", {
      firstName: "Bad",
      lastName: "Phone",
      email: `bad.${Date.now()}@example.com`,
      phone: "not-a-number",
      cohortId: cohort.id,
    });
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
  });

  it("allows creating a student with no phone at all", async () => {
    const cohort = await createTestCohort();
    const { status, body } = await postJson("/api/students", {
      firstName: "No",
      lastName: "Phone",
      email: `nophone.${Date.now()}@example.com`,
      cohortId: cohort.id,
    });
    expect(status).toBe(201);
    expect(body.phone).toBeNull();
  });
});

describe("PUT /api/students/:id — phone normalization on edit only", () => {
  it("normalizes a newly-edited phone number", async () => {
    const cohort = await createTestCohort();
    const created = await postJson("/api/students", {
      firstName: "Edit",
      lastName: "Me",
      email: `editme.${Date.now()}@example.com`,
      cohortId: cohort.id,
    });
    const { status, body } = await putJson(`/api/students/${created.body.id}`, {
      firstName: "Edit",
      lastName: "Me",
      email: created.body.email,
      phone: "0821119997",
      cohortId: cohort.id,
    });
    expect(status).toBe(200);
    expect(body.phone).toBe("+27821119997");
  });
});

describe("No bulk normalization — a legacy-format phone stays untouched unless explicitly edited", () => {
  it("a raw, non-E.164 phone inserted directly (simulating a pre-existing record) is never rewritten by reading it back", async () => {
    const cohort = await createTestCohort();
    const legacy = await prisma.student.create({
      data: {
        firstName: "Legacy",
        lastName: "Record",
        email: `legacy.${Date.now()}@example.com`,
        phone: "0821110000-legacy-format", // deliberately not E.164
        cohortId: cohort.id,
      },
    });

    // Reading the student back (GET) must not have touched the stored value.
    const res = await fetch(`${baseUrl}/api/students/${legacy.id}`, { headers: adminHeaders });
    const body = await res.json();
    expect(body.phone).toBe("0821110000-legacy-format");

    const fromDb = await prisma.student.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(fromDb.phone).toBe("0821110000-legacy-format");
  });
});

describe("POST /api/students/:id/revoke-sessions", () => {
  it("returns ok:true with a revoked count, even if there were no sessions", async () => {
    const cohort = await createTestCohort();
    const created = await postJson("/api/students", {
      firstName: "Revoke",
      lastName: "Target",
      email: `revoke.${Date.now()}@example.com`,
      cohortId: cohort.id,
    });
    const res = await fetch(`${baseUrl}/api/students/${created.body.id}/revoke-sessions`, {
      method: "POST",
      headers: adminHeaders,
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, revoked: 0 });
  });

  it("requires an admin session — returns 401 without one", async () => {
    const cohort = await createTestCohort();
    const created = await postJson("/api/students", {
      firstName: "NoKey",
      lastName: "Target",
      email: `nokey.${Date.now()}@example.com`,
      cohortId: cohort.id,
    });
    const res = await fetch(`${baseUrl}/api/students/${created.body.id}/revoke-sessions`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});
