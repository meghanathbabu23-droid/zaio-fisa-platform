import { randomBytes } from "node:crypto";
import { AdminRole } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { hashPassword } from "../src/lib/adminPassword.js";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, adminAuthConfig } from "../src/lib/adminAuthConfig.js";

let counter = 0;

/** A known-strong password for every test-created Administrator. */
export const TEST_ADMIN_PASSWORD = "Test-Admin-Pass1!";

export async function createTestAdmin(role: AdminRole = AdminRole.SUPER_ADMIN, overrides?: Partial<{ email: string }>) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}${(counter += 1)}`;
  const passwordHash = await hashPassword(TEST_ADMIN_PASSWORD);
  return prisma.administrator.create({
    data: {
      email: overrides?.email ?? `test.admin.${suffix}@example.com`,
      fullName: `Test Admin ${suffix}`,
      passwordHash,
      role,
      active: true,
    },
  });
}

export type AdminAuthHeaders = { Cookie: string; [CSRF_HEADER]: string };

/**
 * Logs an admin in against a live test server (baseUrl) and returns headers
 * that satisfy both requireAdminAuth (session cookie) and the CSRF
 * double-submit check (cookie value echoed in the X-CSRF-Token header) —
 * the cookie-based equivalent of the old TEST_ADMIN_HEADERS shared-key
 * header, for tests that drive the real HTTP routes end to end.
 */
export async function loginTestAdmin(
  baseUrl: string,
  email: string,
  password: string = TEST_ADMIN_PASSWORD
): Promise<AdminAuthHeaders> {
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`loginTestAdmin failed: ${res.status} ${await res.text()}`);
  }
  const setCookies = res.headers.getSetCookie();
  const jar = new Map<string, string>();
  for (const raw of setCookies) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  const sessionToken = jar.get(SESSION_COOKIE);
  const csrfToken = jar.get(CSRF_COOKIE);
  if (!sessionToken || !csrfToken) {
    throw new Error("loginTestAdmin: session or CSRF cookie missing from login response");
  }
  return {
    Cookie: `${SESSION_COOKIE}=${sessionToken}; ${CSRF_COOKIE}=${csrfToken}`,
    [CSRF_HEADER]: csrfToken,
  };
}

/**
 * Creates a SUPER_ADMIN (by default) and an AdminSession row directly via
 * Prisma — bypassing POST /api/admin/login entirely. Most RBAC/CSRF/route
 * tests don't exercise login itself, and the login route is deliberately
 * rate-limited per IP (adminLoginIpLimiter); every test in this suite runs
 * from the same loopback IP, so routing every test's setup through the real
 * HTTP login would trip that limiter. Tests that actually need to exercise
 * the login endpoint (lockout, generic-error behavior, etc.) should call
 * loginTestAdmin directly instead.
 */
export async function createAndLoginTestAdmin(
  role: AdminRole = AdminRole.SUPER_ADMIN
): Promise<{ admin: Awaited<ReturnType<typeof createTestAdmin>>; headers: AdminAuthHeaders }> {
  const admin = await createTestAdmin(role);
  const token = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(32).toString("hex");
  await prisma.adminSession.create({
    data: {
      token,
      adminId: admin.id,
      userAgent: "vitest",
      expiresAt: new Date(Date.now() + adminAuthConfig.sessionTtlMs),
    },
  });
  const headers: AdminAuthHeaders = {
    Cookie: `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrfToken}`,
    [CSRF_HEADER]: csrfToken,
  };
  return { admin, headers };
}

export async function createTestCohort() {
  counter += 1;
  return prisma.cohort.create({
    data: {
      name: `Test Cohort ${counter}-${Date.now()}`,
      programme: "Test programme",
      startDate: new Date(),
      examDate: new Date(Date.now() + 86400000),
      zoomLink: "https://zoom.example/test",
    },
  });
}

function uniqueSuffix(): string {
  // Vitest runs each test file in its own worker, so a plain module-level
  // counter restarts at 0 per file while all files share one test.db —
  // Date.now() + random keeps this unique across files, not just within one.
  counter += 1;
  return `${Date.now()}${Math.floor(Math.random() * 1e6)}${counter}`;
}

export async function createTestStudent(overrides?: Partial<{ email: string; phone: string | null }>) {
  const suffix = uniqueSuffix();
  const cohort = await createTestCohort();
  return prisma.student.create({
    data: {
      firstName: "Test",
      lastName: `Student${suffix}`,
      email: overrides?.email ?? `test.student.${suffix}@example.com`,
      phone: overrides?.phone ?? `+27${suffix.slice(-9).padStart(9, "8")}`,
      cohortId: cohort.id,
    },
  });
}
