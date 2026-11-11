import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { AdminRole } from "@prisma/client";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createTestCohort, createAndLoginTestAdmin, type AdminAuthHeaders } from "./helpers.js";

let baseUrl: string;
let server: ReturnType<typeof app.listen>;
let superAdminHeaders: AdminAuthHeaders;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  superAdminHeaders = (await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN)).headers;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function putEligibility(id: string, eligible: unknown, headers: AdminAuthHeaders = superAdminHeaders) {
  const res = await fetch(`${baseUrl}/api/cohorts/${id}/otp-eligibility`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ eligible }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe("PUT /api/cohorts/:id/otp-eligibility", () => {
  it("enables eligibility and persists it", async () => {
    const cohort = await createTestCohort();
    expect(cohort.realOtpEligible).toBe(false);

    const { status, body } = await putEligibility(cohort.id, true);
    expect(status).toBe(200);
    expect(body).toEqual({ id: cohort.id, realOtpEligible: true });

    const fromDb = await prisma.cohort.findUniqueOrThrow({ where: { id: cohort.id } });
    expect(fromDb.realOtpEligible).toBe(true);
  });

  it("disables eligibility again", async () => {
    const cohort = await createTestCohort();
    await putEligibility(cohort.id, true);
    const { status, body } = await putEligibility(cohort.id, false);
    expect(status).toBe(200);
    expect(body.realOtpEligible).toBe(false);
  });

  it("rejects a non-boolean value", async () => {
    const cohort = await createTestCohort();
    const { status } = await putEligibility(cohort.id, "yes");
    expect(status).toBe(400);
  });

  it("returns 404 for a nonexistent cohort", async () => {
    const { status } = await putEligibility("nonexistent-id", true);
    expect(status).toBe(404);
  });

  it("does not touch the cohort's other fields (name, programme, etc.)", async () => {
    const cohort = await createTestCohort();
    await putEligibility(cohort.id, true);
    const fromDb = await prisma.cohort.findUniqueOrThrow({ where: { id: cohort.id } });
    expect(fromDb.name).toBe(cohort.name);
    expect(fromDb.programme).toBe(cohort.programme);
  });

  it("requires an admin session — returns 401 without one, and the cohort is unchanged", async () => {
    const cohort = await createTestCohort();
    const res = await fetch(`${baseUrl}/api/cohorts/${cohort.id}/otp-eligibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eligible: true }),
    });
    expect(res.status).toBe(401);
    const fromDb = await prisma.cohort.findUniqueOrThrow({ where: { id: cohort.id } });
    expect(fromDb.realOtpEligible).toBe(false);
  });

  it("is SUPER_ADMIN-only — a logged-in ADMIN gets 403, and the cohort is unchanged", async () => {
    const cohort = await createTestCohort();
    const { headers } = await createAndLoginTestAdmin(AdminRole.ADMIN);
    const { status } = await putEligibility(cohort.id, true, headers);
    expect(status).toBe(403);
    const fromDb = await prisma.cohort.findUniqueOrThrow({ where: { id: cohort.id } });
    expect(fromDb.realOtpEligible).toBe(false);
  });
});
