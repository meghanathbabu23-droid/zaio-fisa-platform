import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { AdminRole } from "@prisma/client";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createTestAdmin, loginTestAdmin, TEST_ADMIN_PASSWORD } from "./helpers.js";
import { MockEmailProvider } from "../src/lib/providers/index.js";
import { SESSION_COOKIE, CSRF_COOKIE } from "../src/lib/adminAuthConfig.js";

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

describe("POST /api/admin/login", () => {
  it("succeeds with correct credentials, sets both cookies, and records a LOGIN_SUCCESS audit row", async () => {
    const admin = await createTestAdmin(AdminRole.ADMIN);
    const res = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email, password: TEST_ADMIN_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: admin.id, email: admin.email, role: "ADMIN" });

    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`) && c.includes("HttpOnly"))).toBe(true);
    expect(setCookies.some((c) => c.startsWith(`${CSRF_COOKIE}=`) && !c.includes("HttpOnly"))).toBe(true);

    const logs = await prisma.adminAuditLog.findMany({ where: { adminId: admin.id, action: "LOGIN_SUCCESS" } });
    expect(logs.length).toBe(1);
  });

  it("never returns or logs the password hash", async () => {
    const admin = await createTestAdmin();
    const res = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email, password: TEST_ADMIN_PASSWORD }),
    });
    const text = await res.text();
    expect(text).not.toContain(admin.passwordHash);

    const logs = await prisma.adminAuditLog.findMany({ where: { adminId: admin.id } });
    for (const log of logs) {
      expect(log.detail).not.toContain(admin.passwordHash);
    }
  });

  it("rejects an inactive administrator with the same generic error as a wrong password", async () => {
    const admin = await createTestAdmin();
    await prisma.administrator.update({ where: { id: admin.id }, data: { active: false } });
    const res = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email, password: TEST_ADMIN_PASSWORD }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a missing email or password with 400, not 401/500", async () => {
    const res = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/me", () => {
  it("returns the authenticated admin's identity (never the password hash)", async () => {
    const admin = await createTestAdmin(AdminRole.ASSESSOR);
    const headers = await loginTestAdmin(baseUrl, admin.email);
    const res = await fetch(`${baseUrl}/api/admin/me`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: admin.id, role: "ASSESSOR", email: admin.email, fullName: admin.fullName });
    expect(JSON.stringify(body)).not.toContain(admin.passwordHash);
  });

  it("401s with no session (session-expired handling on the frontend relies on this)", async () => {
    const res = await fetch(`${baseUrl}/api/admin/me`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/admin/logout", () => {
  it("clears the session so a subsequent /me call 401s, and records a LOGOUT audit row", async () => {
    const admin = await createTestAdmin();
    const headers = await loginTestAdmin(baseUrl, admin.email);

    const logoutRes = await fetch(`${baseUrl}/api/admin/logout`, { method: "POST", headers });
    expect(logoutRes.status).toBe(204);

    const meRes = await fetch(`${baseUrl}/api/admin/me`, { headers });
    expect(meRes.status).toBe(401);

    const logs = await prisma.adminAuditLog.findMany({ where: { adminId: admin.id, action: "LOGOUT" } });
    expect(logs.length).toBe(1);
  });
});

describe("POST /api/admin/change-password", () => {
  it("rejects the wrong current password", async () => {
    const admin = await createTestAdmin();
    const headers = await loginTestAdmin(baseUrl, admin.email);
    const res = await fetch(`${baseUrl}/api/admin/change-password`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "wrong", newPassword: "New-Strong-Pass1!" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a weak new password", async () => {
    const admin = await createTestAdmin();
    const headers = await loginTestAdmin(baseUrl, admin.email);
    const res = await fetch(`${baseUrl}/api/admin/change-password`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: TEST_ADMIN_PASSWORD, newPassword: "weak" }),
    });
    expect(res.status).toBe(400);
  });

  it("changes the password, revokes OTHER sessions but keeps the current one, and the new password works on next login", async () => {
    const admin = await createTestAdmin();
    const headersA = await loginTestAdmin(baseUrl, admin.email);
    const headersB = await loginTestAdmin(baseUrl, admin.email);

    const newPassword = "New-Strong-Pass1!";
    const changeRes = await fetch(`${baseUrl}/api/admin/change-password`, {
      method: "POST",
      headers: { ...headersA, "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: TEST_ADMIN_PASSWORD, newPassword }),
    });
    expect(changeRes.status).toBe(200);

    // Session A (the one that made the change) still works.
    const meA = await fetch(`${baseUrl}/api/admin/me`, { headers: headersA });
    expect(meA.status).toBe(200);

    // Session B (a different login) was revoked.
    const meB = await fetch(`${baseUrl}/api/admin/me`, { headers: headersB });
    expect(meB.status).toBe(401);

    // Old password no longer works; new one does.
    const oldLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email, password: TEST_ADMIN_PASSWORD }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email, password: newPassword }),
    });
    expect(newLogin.status).toBe(200);
  });
});

describe("Password reset workflow", () => {
  it("request always returns the same generic message whether or not the email is registered", async () => {
    const admin = await createTestAdmin();
    const registered = await fetch(`${baseUrl}/api/admin/password-reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email }),
    });
    const unregistered = await fetch(`${baseUrl}/api/admin/password-reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody-admin@example.com" }),
    });
    expect(registered.status).toBe(200);
    expect(unregistered.status).toBe(200);
    expect(await registered.text()).toBe(await unregistered.text());
  });

  it("sends an email (mock provider) containing a reset link, never the raw token being misquoted as the email's password", async () => {
    const admin = await createTestAdmin();
    await fetch(`${baseUrl}/api/admin/password-reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email }),
    });
    const sent = MockEmailProvider.lastGenericSend;
    expect(sent?.to).toBe(admin.email);
    expect(sent?.text).toContain("/admin/reset-password?token=");
  });

  it("confirm with a bogus token is rejected", async () => {
    const res = await fetch(`${baseUrl}/api/admin/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "not-a-real-token", newPassword: "New-Strong-Pass1!" }),
    });
    expect(res.status).toBe(400);
  });

  it("confirm with the real token sets the new password, revokes ALL sessions, and the token can't be reused", async () => {
    const admin = await createTestAdmin();
    const priorHeaders = await loginTestAdmin(baseUrl, admin.email);

    await fetch(`${baseUrl}/api/admin/password-reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email }),
    });
    const sent = MockEmailProvider.lastGenericSend!;
    const token = new URL(sent.text.match(/https?:\S+/)![0]).searchParams.get("token")!;

    const newPassword = "Reset-Strong-Pass1!";
    const confirmRes = await fetch(`${baseUrl}/api/admin/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    expect(confirmRes.status).toBe(200);

    // Prior session (from before the reset) is now revoked.
    const meAfter = await fetch(`${baseUrl}/api/admin/me`, { headers: priorHeaders });
    expect(meAfter.status).toBe(401);

    // New password logs in; old one doesn't.
    const newLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email, password: newPassword }),
    });
    expect(newLogin.status).toBe(200);

    // Reusing the same token fails.
    const reuseRes = await fetch(`${baseUrl}/api/admin/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "Another-Strong-Pass1!" }),
    });
    expect(reuseRes.status).toBe(400);
  });
});
