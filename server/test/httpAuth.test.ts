import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { resetRateLimitStateForTests } from "../src/lib/rateLimit.js";
import { MockEmailProvider } from "../src/lib/providers/index.js";
import { createTestStudent } from "./helpers.js";

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

beforeEach(() => {
  resetRateLimitStateForTests();
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe("POST /api/auth/otp/request — identifier validation", () => {
  it("rejects a body with neither email nor phone", async () => {
    const { status } = await post("/api/auth/otp/request", {});
    expect(status).toBe(400);
  });

  it("rejects a body with BOTH email and phone (exactly-one rule)", async () => {
    const { status } = await post("/api/auth/otp/request", {
      email: "a@example.com",
      phone: "+27821110000",
    });
    expect(status).toBe(400);
  });

  it("accepts email-only", async () => {
    const student = await createTestStudent();
    const { status, body } = await post("/api/auth/otp/request", { email: student.email });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.cooldownSeconds).toBe(60);
  });
});

describe("POST /api/auth/otp/request — never leaks whether an identifier is registered", () => {
  it("returns the identical response shape/status for a registered and an unregistered email", async () => {
    const student = await createTestStudent();
    const known = await post("/api/auth/otp/request", { email: student.email });
    const unknown = await post("/api/auth/otp/request", { email: `nobody-${Date.now()}@example.com` });
    expect(known.status).toBe(unknown.status);
    expect(Object.keys(known.body).sort()).toEqual(Object.keys(unknown.body).sort());
    expect(known.body.message).toBe(unknown.body.message);
  });

  it("never includes an OTP code in the response, for a known identifier", async () => {
    const student = await createTestStudent();
    const { body } = await post("/api/auth/otp/request", { email: student.email });
    expect(JSON.stringify(body)).not.toMatch(/"\d{6}"/);
  });
});

describe("POST /api/auth/otp/verify — generic error, no enumeration", () => {
  it("returns the same status+message for an unregistered identifier as for a wrong code on a real one", async () => {
    const student = await createTestStudent();
    await post("/api/auth/otp/request", { email: student.email });

    const wrongCodeOnReal = await post("/api/auth/otp/verify", { email: student.email, code: "000000" });
    const unregistered = await post("/api/auth/otp/verify", {
      email: `ghost-${Date.now()}@example.com`,
      code: "000000",
    });

    expect(wrongCodeOnReal.status).toBe(unregistered.status);
    expect(wrongCodeOnReal.body.error).toBe(unregistered.body.error);
  });
});

describe("Full login round trip via HTTP, then logout", () => {
  it("request -> capture via mock -> verify -> use token -> logout -> token rejected", async () => {
    const student = await createTestStudent();
    await post("/api/auth/otp/request", { email: student.email });
    const captured = MockEmailProvider.sent.get(student.email)!;

    const verifyRes = await post("/api/auth/otp/verify", { email: student.email, code: captured.code });
    expect(verifyRes.status).toBe(200);
    const token = verifyRes.body.token as string;

    const assignmentsRes = await fetch(`${baseUrl}/api/student/assignments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(assignmentsRes.status).toBe(200);

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logoutRes.status).toBe(204);

    const afterLogout = await fetch(`${baseUrl}/api/student/assignments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(afterLogout.status).toBe(401);
  });

  it("a second login invalidates the first session's token for protected routes", async () => {
    const student = await createTestStudent();

    await post("/api/auth/otp/request", { email: student.email });
    const firstCode = MockEmailProvider.sent.get(student.email)!.code;
    const firstVerify = await post("/api/auth/otp/verify", { email: student.email, code: firstCode });
    const firstToken = firstVerify.body.token as string;

    resetRateLimitStateForTests(); // simulate the 60s resend cooldown having passed
    await post("/api/auth/otp/request", { email: student.email });
    const secondCode = MockEmailProvider.sent.get(student.email)!.code;
    const secondVerify = await post("/api/auth/otp/verify", { email: student.email, code: secondCode });
    const secondToken = secondVerify.body.token as string;

    const withFirst = await fetch(`${baseUrl}/api/student/assignments`, {
      headers: { Authorization: `Bearer ${firstToken}` },
    });
    expect(withFirst.status).toBe(401);

    const withSecond = await fetch(`${baseUrl}/api/student/assignments`, {
      headers: { Authorization: `Bearer ${secondToken}` },
    });
    expect(withSecond.status).toBe(200);
  });
});

describe("Resend cooldown at the HTTP layer", () => {
  it("a second /otp/request for the same identifier within 60s is rate limited", async () => {
    const student = await createTestStudent();
    const first = await post("/api/auth/otp/request", { email: student.email });
    expect(first.status).toBe(200);
    const second = await post("/api/auth/otp/request", { email: student.email });
    expect(second.status).toBe(429);
  });
});

describe("Mock introspection endpoint is gated", () => {
  it("returns 404 for an identifier with nothing captured", async () => {
    const res = await fetch(`${baseUrl}/api/test/last-otp?channel=EMAIL&value=never-requested@example.com`);
    expect(res.status).toBe(404);
  });

  it("returns the captured code for a real request", async () => {
    const student = await createTestStudent();
    await post("/api/auth/otp/request", { email: student.email });
    const res = await fetch(
      `${baseUrl}/api/test/last-otp?channel=EMAIL&value=${encodeURIComponent(student.email)}`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.code).toBe("string");
    expect(body.code).toMatch(/^\d{6}$/);
  });

  it("404s even for a captured code if NODE_ENV flips to production — a second, independent guard beyond the deliveryMode check, in case the boot-time production/mock exclusion is ever weakened", async () => {
    const student = await createTestStudent();
    await post("/api/auth/otp/request", { email: student.email });

    const savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await fetch(
        `${baseUrl}/api/test/last-otp?channel=EMAIL&value=${encodeURIComponent(student.email)}`
      );
      expect(res.status).toBe(404);
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
    }

    // Restoring NODE_ENV brings it back — confirms the 404 above was really
    // this guard, not some other failure masquerading as one.
    const resAfterRestore = await fetch(
      `${baseUrl}/api/test/last-otp?channel=EMAIL&value=${encodeURIComponent(student.email)}`
    );
    expect(resAfterRestore.status).toBe(200);
  });
});

describe("Open tester self-registration is disabled by default", () => {
  it("404s on /api/auth/register-tester when ENABLE_OPEN_TEST_REGISTRATION was never set (this file's app, like every other test file's, was imported without it)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/register-tester`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "Should Not Work", email: "should.not.work@example.com", phone: "+27821119111" }),
    });
    expect(res.status).toBe(404);

    const created = await prisma.student.findUnique({ where: { email: "should.not.work@example.com" } });
    expect(created).toBeNull();
  });
});
