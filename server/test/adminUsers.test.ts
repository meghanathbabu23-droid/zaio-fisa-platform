import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { AdminRole } from "@prisma/client";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import {
  createTestAdmin,
  createAndLoginTestAdmin,
  loginTestAdmin,
  TEST_ADMIN_PASSWORD,
  type AdminAuthHeaders,
} from "./helpers.js";

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

describe("GET /api/admin/users", () => {
  it("never includes passwordHash in the listing", async () => {
    await createTestAdmin(AdminRole.ADMIN);
    const res = await fetch(`${baseUrl}/api/admin/users`, { headers: superHeaders });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const row of body) {
      expect(row).not.toHaveProperty("passwordHash");
    }
  });
});

describe("POST /api/admin/users — create administrator", () => {
  it("creates a new administrator with a valid role and strong password, and records ADMIN_CREATED", async () => {
    const email = `new.admin.${Date.now()}@example.com`;
    const res = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "New Admin", email, password: "Brand-New-Pass1!", role: "MODERATOR" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).not.toHaveProperty("passwordHash");
    expect(body.role).toBe("MODERATOR");

    const logs = await prisma.adminAuditLog.findMany({ where: { targetId: body.id, action: "ADMIN_CREATED" } });
    expect(logs.length).toBe(1);

    // The new account can actually log in with the password that was set.
    const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Brand-New-Pass1!" }),
    });
    expect(loginRes.status).toBe(200);
  });

  it("rejects a weak password", async () => {
    const res = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "Weak Pw", email: `weak.${Date.now()}@example.com`, password: "weak", role: "ADMIN" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate email", async () => {
    const admin = await createTestAdmin();
    const res = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "Dup", email: admin.email, password: "Brand-New-Pass1!", role: "ADMIN" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid role", async () => {
    const res = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Bad Role",
        email: `badrole.${Date.now()}@example.com`,
        password: "Brand-New-Pass1!",
        role: "SUPREME_LEADER",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("an ADMIN (not SUPER_ADMIN) cannot create administrator accounts", async () => {
    const { headers } = await createAndLoginTestAdmin(AdminRole.ADMIN);
    const res = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Should Fail",
        email: `shouldfail.${Date.now()}@example.com`,
        password: "Brand-New-Pass1!",
        role: "ADMIN",
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/admin/users/:id — update administrator", () => {
  it("updates role and active status, and records ADMIN_UPDATED", async () => {
    const target = await createTestAdmin(AdminRole.MODERATOR);
    const res = await fetch(`${baseUrl}/api/admin/users/${target.id}`, {
      method: "PUT",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "ASSESSOR", active: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("ASSESSOR");

    const logs = await prisma.adminAuditLog.findMany({ where: { targetId: target.id, action: "ADMIN_UPDATED" } });
    expect(logs.length).toBe(1);
  });

  it("refuses to let an admin deactivate their OWN account (self-lockout prevention)", async () => {
    const { admin, headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);
    const res = await fetch(`${baseUrl}/api/admin/users/${admin.id}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    expect(res.status).toBe(400);
    const fromDb = await prisma.administrator.findUniqueOrThrow({ where: { id: admin.id } });
    expect(fromDb.active).toBe(true);
  });

  it("refuses to let a SUPER_ADMIN change their OWN role (the other self-lockout vector — demoting yourself with no other SUPER_ADMIN around)", async () => {
    const { admin, headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);
    const res = await fetch(`${baseUrl}/api/admin/users/${admin.id}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "ADMIN" }),
    });
    expect(res.status).toBe(400);
    const fromDb = await prisma.administrator.findUniqueOrThrow({ where: { id: admin.id } });
    expect(fromDb.role).toBe("SUPER_ADMIN");
  });

  it("still allows other self-edits (e.g. fullName) alongside a no-op role value equal to the admin's current role", async () => {
    const { admin, headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);
    const res = await fetch(`${baseUrl}/api/admin/users/${admin.id}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "Renamed Self", role: "SUPER_ADMIN" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fullName).toBe("Renamed Self");
    expect(body.role).toBe("SUPER_ADMIN");
  });

  it("a SUPER_ADMIN CAN change another admin's role, including promoting someone to SUPER_ADMIN", async () => {
    const superHeaders = (await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN)).headers;
    const target = await createTestAdmin(AdminRole.ADMIN);
    const res = await fetch(`${baseUrl}/api/admin/users/${target.id}`, {
      method: "PUT",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "SUPER_ADMIN" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("SUPER_ADMIN");
  });
});

describe("Revoking your OWN sessions logs you out but is not a permanent lockout", () => {
  it("revoking your own sessions ends the current session, but the password still works for a fresh login", async () => {
    const { admin, headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);
    const revokeRes = await fetch(`${baseUrl}/api/admin/users/${admin.id}/revoke-sessions`, {
      method: "POST",
      headers,
    });
    expect(revokeRes.status).toBe(200);

    const meAfterRevoke = await fetch(`${baseUrl}/api/admin/me`, { headers });
    expect(meAfterRevoke.status).toBe(401);

    // Not a lockout — the account itself is untouched and a fresh login works.
    const freshLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email, password: TEST_ADMIN_PASSWORD }),
    });
    expect(freshLogin.status).toBe(200);
  });
});

describe("DELETE /api/admin/users/:id", () => {
  it("deletes an administrator and records ADMIN_DELETED, with adminId preserved as null on their past audit rows", async () => {
    const target = await createTestAdmin(AdminRole.ASSESSOR);
    const loginHeaders = await loginTestAdmin(baseUrl, target.email);
    // Generate at least one audit row attributed to the target before deleting them.
    await fetch(`${baseUrl}/api/admin/logout`, { method: "POST", headers: loginHeaders });

    const res = await fetch(`${baseUrl}/api/admin/users/${target.id}`, {
      method: "DELETE",
      headers: superHeaders,
    });
    expect(res.status).toBe(204);

    const fromDb = await prisma.administrator.findUnique({ where: { id: target.id } });
    expect(fromDb).toBeNull();

    // The historical LOGOUT row survives with adminId set to null (SetNull), not deleted.
    const survivingLogs = await prisma.adminAuditLog.findMany({ where: { targetId: target.id, action: "LOGOUT" } });
    expect(survivingLogs.length).toBe(1);
    expect(survivingLogs[0].adminId).toBeNull();
  });

  it("refuses to let an admin delete their OWN account", async () => {
    const { admin, headers } = await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN);
    const res = await fetch(`${baseUrl}/api/admin/users/${admin.id}`, { method: "DELETE", headers });
    expect(res.status).toBe(400);
    const fromDb = await prisma.administrator.findUnique({ where: { id: admin.id } });
    expect(fromDb).not.toBeNull();
  });
});

describe("POST /api/admin/users/:id/revoke-sessions", () => {
  it("revokes every active session for the target admin, and records ADMIN_SESSIONS_REVOKED", async () => {
    const target = await createTestAdmin(AdminRole.ADMIN);
    const targetHeaders = await loginTestAdmin(baseUrl, target.email);

    const revokeRes = await fetch(`${baseUrl}/api/admin/users/${target.id}/revoke-sessions`, {
      method: "POST",
      headers: superHeaders,
    });
    expect(revokeRes.status).toBe(200);
    const body = await revokeRes.json();
    expect(body.revoked).toBeGreaterThanOrEqual(1);

    const meRes = await fetch(`${baseUrl}/api/admin/me`, { headers: targetHeaders });
    expect(meRes.status).toBe(401);

    const logs = await prisma.adminAuditLog.findMany({ where: { targetId: target.id, action: "ADMIN_SESSIONS_REVOKED" } });
    expect(logs.length).toBe(1);
  });
});
