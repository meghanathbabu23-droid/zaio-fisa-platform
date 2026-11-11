import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { AdminRole } from "@prisma/client";
import { app } from "../src/app.js";
import { createTestStudent, createAndLoginTestAdmin, TEST_ADMIN_PASSWORD } from "./helpers.js";
import { requestOtp, verifyOtp, OtpChannel } from "../src/lib/otp.js";
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

const { SUPER_ADMIN, ADMIN, ASSESSOR, MODERATOR } = AdminRole;

const ADMIN_ROUTES: { method: string; path: string; allowed: AdminRole[] }[] = [
  { method: "GET", path: "/api/cohorts", allowed: [SUPER_ADMIN, ADMIN] },
  { method: "GET", path: "/api/students", allowed: [SUPER_ADMIN, ADMIN] },
  { method: "GET", path: "/api/exams", allowed: [SUPER_ADMIN, ADMIN] },
  { method: "GET", path: "/api/assessor/practical-submissions", allowed: [SUPER_ADMIN, ASSESSOR] },
  { method: "GET", path: "/api/results", allowed: [SUPER_ADMIN, ADMIN] },
  { method: "GET", path: "/api/moderation", allowed: [SUPER_ADMIN, MODERATOR] },
  { method: "GET", path: "/api/evidence", allowed: [SUPER_ADMIN, ADMIN] },
  { method: "GET", path: "/api/assignments", allowed: [SUPER_ADMIN, ADMIN] },
  { method: "GET", path: "/api/proctoring/sessions", allowed: [SUPER_ADMIN, ADMIN] },
  { method: "GET", path: "/api/otp-delivery-failures", allowed: [SUPER_ADMIN] },
  { method: "GET", path: "/api/admin/users", allowed: [SUPER_ADMIN] },
  { method: "GET", path: "/api/admin/status/delivery", allowed: [SUPER_ADMIN] },
];

const ALL_ROLES: AdminRole[] = [SUPER_ADMIN, ADMIN, ASSESSOR, MODERATOR];

describe("Every administrative router requires a valid admin session (HTTP sweep)", () => {
  it.each(ADMIN_ROUTES)("$method $path -> 401 with no session at all", async ({ method, path }) => {
    const res = await fetch(`${baseUrl}${path}`, { method });
    expect(res.status).toBe(401);
  });

  it.each(ADMIN_ROUTES)("$method $path -> 401 with a bogus/forged session cookie", async ({ method, path }) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Cookie: "fisa_admin_session=not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });

  for (const { method, path, allowed } of ADMIN_ROUTES) {
    it(`${method} ${path} -> 200 for an allowed role, 403 for a disallowed role`, async () => {
      for (const role of ALL_ROLES) {
        const { headers } = await createAndLoginTestAdmin(role);
        const res = await fetch(`${baseUrl}${path}`, { method, headers });
        if (allowed.includes(role)) {
          expect(res.status).toBe(200);
        } else {
          expect(res.status).toBe(403);
        }
      }
    });
  }
});

describe("Method-level RBAC tightening beyond router-level mount (SUPER_ADMIN-only writes)", () => {
  it("ADMIN can read exams but cannot create one; SUPER_ADMIN can", async () => {
    const adminHeaders = (await createAndLoginTestAdmin(ADMIN)).headers;
    const createRes = await fetch(`${baseUrl}/api/exams`, {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Should fail", type: "PRACTICAL", durationMinutes: 60 }),
    });
    expect(createRes.status).toBe(403);

    const superHeaders = (await createAndLoginTestAdmin(SUPER_ADMIN)).headers;
    const okRes = await fetch(`${baseUrl}/api/exams`, {
      method: "POST",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Allowed practical", type: "PRACTICAL", durationMinutes: 60 }),
    });
    expect(okRes.status).toBe(201);
  });

  it("ADMIN cannot toggle cohort OTP eligibility; SUPER_ADMIN can", async () => {
    const { headers: adminHeaders } = await createAndLoginTestAdmin(ADMIN);
    const cohortRes = await fetch(`${baseUrl}/api/cohorts`, {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "RBAC test cohort",
        programme: "Test",
        startDate: new Date().toISOString(),
        examDate: new Date(Date.now() + 86400000).toISOString(),
        zoomLink: "https://zoom.example/rbac",
      }),
    });
    expect(cohortRes.status).toBe(201);
    const cohort = await cohortRes.json();

    const toggleAsAdmin = await fetch(`${baseUrl}/api/cohorts/${cohort.id}/otp-eligibility`, {
      method: "PUT",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ eligible: true }),
    });
    expect(toggleAsAdmin.status).toBe(403);

    const { headers: superHeaders } = await createAndLoginTestAdmin(SUPER_ADMIN);
    const toggleAsSuper = await fetch(`${baseUrl}/api/cohorts/${cohort.id}/otp-eligibility`, {
      method: "PUT",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ eligible: true }),
    });
    expect(toggleAsSuper.status).toBe(200);
  });

  it("ADMIN can read a practical exam's test cases but cannot create one (they're effectively the answer key); SUPER_ADMIN can", async () => {
    const { headers: superHeaders } = await createAndLoginTestAdmin(SUPER_ADMIN);
    const examRes = await fetch(`${baseUrl}/api/exams`, {
      method: "POST",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Practical for test-case RBAC", type: "PRACTICAL", durationMinutes: 60 }),
    });
    expect(examRes.status).toBe(201);
    const exam = await examRes.json();

    const testCaseBody = {
      label: "Has an h1",
      kind: "HTML_SELECTOR",
      expression: "h1",
      points: 1,
    };

    const { headers: adminHeaders } = await createAndLoginTestAdmin(ADMIN);
    const readAsAdmin = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-tests`, { headers: adminHeaders });
    expect(readAsAdmin.status).toBe(200);

    const createAsAdmin = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-tests`, {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(testCaseBody),
    });
    expect(createAsAdmin.status).toBe(403);

    const createAsSuper = await fetch(`${baseUrl}/api/exams/${exam.id}/practical-tests`, {
      method: "POST",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(testCaseBody),
    });
    expect(createAsSuper.status).toBe(201);
  });
});

describe("CSRF double-submit protection", () => {
  it("rejects a mutating request with a valid session cookie but no CSRF header", async () => {
    const { headers } = await createAndLoginTestAdmin(SUPER_ADMIN);
    const res = await fetch(`${baseUrl}/api/cohorts`, {
      method: "POST",
      headers: { Cookie: headers.Cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "No CSRF",
        programme: "Test",
        startDate: new Date().toISOString(),
        examDate: new Date(Date.now() + 86400000).toISOString(),
        zoomLink: "https://zoom.example/nocsrf",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a mutating request where the CSRF header doesn't match the cookie", async () => {
    const { headers } = await createAndLoginTestAdmin(SUPER_ADMIN);
    const res = await fetch(`${baseUrl}/api/cohorts`, {
      method: "POST",
      headers: { ...headers, "x-csrf-token": "wrong-value", "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bad CSRF",
        programme: "Test",
        startDate: new Date().toISOString(),
        examDate: new Date(Date.now() + 86400000).toISOString(),
        zoomLink: "https://zoom.example/badcsrf",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("GET requests don't require a CSRF header", async () => {
    const { headers } = await createAndLoginTestAdmin(SUPER_ADMIN);
    const res = await fetch(`${baseUrl}/api/cohorts`, { headers: { Cookie: headers.Cookie } });
    expect(res.status).toBe(200);
  });
});

describe("Account lockout", () => {
  it("locks the account after repeated failed logins and returns 423, not 401, once locked", async () => {
    const { admin } = await createAndLoginTestAdmin(SUPER_ADMIN);
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: admin.email, password: "definitely-wrong-password" }),
      });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(423);

    // Even the CORRECT password is rejected while locked.
    const correctWhileLocked = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email, password: TEST_ADMIN_PASSWORD }),
    });
    expect(correctWhileLocked.status).toBe(423);
  });

  it("a nonexistent email and a wrong password both return the same generic 401", async () => {
    const { admin } = await createAndLoginTestAdmin(SUPER_ADMIN);
    const wrongPassword = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email, password: "nope-wrong" }),
    });
    const noSuchEmail = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "no-such-admin@example.com", password: "nope-wrong" }),
    });
    expect(wrongPassword.status).toBe(401);
    expect(noSuchEmail.status).toBe(401);
    expect(await wrongPassword.text()).toBe(await noSuchEmail.text());
  });
});

describe("Explicitly exempted routes remain public / student-authenticated, unaffected by admin protection", () => {
  it("GET /api/health is public — no session needed", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
  });

  it("student OTP request/verify still work with no admin session at all", async () => {
    const student = await createTestStudent();
    const reqRes = await fetch(`${baseUrl}/api/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: student.email }),
    });
    expect(reqRes.status).toBe(200);

    const code = MockEmailProvider.sent.get(student.email)?.code;
    const verifyRes = await fetch(`${baseUrl}/api/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: student.email, code }),
    });
    expect(verifyRes.status).toBe(200);
  });

  it("student-protected routes still require STUDENT auth — an admin session alone doesn't satisfy requireStudent", async () => {
    const { headers } = await createAndLoginTestAdmin(SUPER_ADMIN);
    const res = await fetch(`${baseUrl}/api/student/assignments`, { headers });
    expect(res.status).toBe(401);
  });

  it("a real student session token still works on student routes with no admin session", async () => {
    const student = await createTestStudent();
    const otp = await requestOtp({ channel: OtpChannel.EMAIL, value: student.email });
    expect(otp.ok).toBe(true);
    const code = MockEmailProvider.sent.get(student.email)!.code;
    const verified = await verifyOtp({ channel: OtpChannel.EMAIL, value: student.email, code });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    const res = await fetch(`${baseUrl}/api/student/assignments`, {
      headers: { Authorization: `Bearer ${verified.token}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("CORS", () => {
  it("preflight OPTIONS for an admin route succeeds without a session and allows X-CSRF-Token", async () => {
    const res = await fetch(`${baseUrl}/api/cohorts`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-CSRF-Token",
      },
    });
    expect(res.status).toBeLessThan(300);
    const allowHeaders = res.headers.get("access-control-allow-headers") ?? "";
    expect(allowHeaders.toLowerCase()).toContain("x-csrf-token");
  });

  it("an allowed origin is echoed back in Access-Control-Allow-Origin, with credentials allowed", async () => {
    const { headers } = await createAndLoginTestAdmin(SUPER_ADMIN);
    const res = await fetch(`${baseUrl}/api/cohorts`, {
      headers: { Origin: "http://localhost:5173", ...headers },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("a non-allow-listed origin does not get Access-Control-Allow-Origin set", async () => {
    const { headers } = await createAndLoginTestAdmin(SUPER_ADMIN);
    const res = await fetch(`${baseUrl}/api/cohorts`, {
      headers: { Origin: "https://evil.example.com", ...headers },
    });
    expect(res.headers.get("access-control-allow-origin")).not.toBe("https://evil.example.com");
  });

  it("a request with NO Origin header (curl/Node fetch/demo-smoke.mjs) is never blocked by CORS", async () => {
    const { headers } = await createAndLoginTestAdmin(SUPER_ADMIN);
    const res = await fetch(`${baseUrl}/api/cohorts`, { headers });
    expect(res.status).toBe(200);
  });
});
