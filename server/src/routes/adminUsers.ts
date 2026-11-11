import { Router } from "express";
import { AdminRole } from "@prisma/client";
import { prisma } from "../prisma.js";
import { isStrongPassword } from "../lib/adminAuthConfig.js";
import { hashPassword } from "../lib/adminPassword.js";
import { recordAuditLog } from "../lib/auditLog.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";

/** SUPER_ADMIN-only administrator account management. Mounted with
 * requireAdminAuth + requireRole(SUPER_ADMIN) in app.ts. */
export const adminUsersRouter = Router();

const SAFE_SELECT = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  lastLoginAt: true,
  lockedUntil: true,
} as const;

adminUsersRouter.get("/", async (_req, res) => {
  const admins = await prisma.administrator.findMany({
    select: SAFE_SELECT,
    orderBy: { createdAt: "asc" },
  });
  res.json(admins);
});

adminUsersRouter.post("/", async (req: AuthedAdminRequest, res) => {
  const { fullName, email, password, role } = req.body as Record<string, unknown>;
  if (
    typeof fullName !== "string" ||
    !fullName.trim() ||
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string" ||
    typeof role !== "string" ||
    !(Object.values(AdminRole) as string[]).includes(role)
  ) {
    res.status(400).json({ error: "fullName, email, password, and a valid role are required." });
    return;
  }
  const strength = isStrongPassword(password);
  if (!strength.ok) {
    res.status(400).json({ error: strength.reason });
    return;
  }

  try {
    const passwordHash = await hashPassword(password);
    const admin = await prisma.administrator.create({
      data: { fullName: fullName.trim(), email: email.trim().toLowerCase(), passwordHash, role: role as AdminRole },
      select: SAFE_SELECT,
    });
    await recordAuditLog({
      adminId: req.admin!.id,
      action: "ADMIN_CREATED",
      targetType: "Administrator",
      targetId: admin.id,
      detail: `role=${admin.role}`,
    });
    res.status(201).json(admin);
  } catch {
    res.status(400).json({ error: "Email already registered." });
  }
});

adminUsersRouter.put("/:id", async (req: AuthedAdminRequest, res) => {
  const { fullName, role, active } = req.body as Record<string, unknown>;
  const isSelf = req.params.id === req.admin!.id;
  if (isSelf && active === false) {
    res.status(400).json({ error: "You cannot deactivate your own account." });
    return;
  }
  // Changing your OWN role — not just deactivating — is the other
  // self-lockout vector: a SUPER_ADMIN demoting themselves (e.g. a misclick
  // or a role dropdown left on the wrong value) with no other SUPER_ADMIN
  // around would permanently lose access to this very page, with no API
  // left able to undo it. Any admin, of any role, must have another admin
  // change their role for them.
  if (isSelf && typeof role === "string" && role !== req.admin!.role) {
    res.status(400).json({ error: "You cannot change your own role. Ask another administrator to do it." });
    return;
  }
  const data: { fullName?: string; role?: AdminRole; active?: boolean } = {};
  if (typeof fullName === "string" && fullName.trim()) data.fullName = fullName.trim();
  if (typeof role === "string" && (Object.values(AdminRole) as string[]).includes(role)) data.role = role as AdminRole;
  if (typeof active === "boolean") data.active = active;

  try {
    const admin = await prisma.administrator.update({ where: { id: req.params.id }, data, select: SAFE_SELECT });
    await recordAuditLog({
      adminId: req.admin!.id,
      action: "ADMIN_UPDATED",
      targetType: "Administrator",
      targetId: admin.id,
      detail: Object.keys(data).join(","),
    });
    res.json(admin);
  } catch {
    res.status(404).json({ error: "Administrator not found." });
  }
});

adminUsersRouter.delete("/:id", async (req: AuthedAdminRequest, res) => {
  if (req.params.id === req.admin!.id) {
    res.status(400).json({ error: "You cannot delete your own account." });
    return;
  }
  try {
    await prisma.administrator.delete({ where: { id: req.params.id } });
    await recordAuditLog({
      adminId: req.admin!.id,
      action: "ADMIN_DELETED",
      targetType: "Administrator",
      targetId: req.params.id,
    });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: "Administrator not found." });
  }
});

adminUsersRouter.post("/:id/revoke-sessions", async (req: AuthedAdminRequest, res) => {
  const result = await prisma.adminSession.deleteMany({ where: { adminId: req.params.id } });
  await recordAuditLog({
    adminId: req.admin!.id,
    action: "ADMIN_SESSIONS_REVOKED",
    targetType: "Administrator",
    targetId: req.params.id,
    detail: `revoked=${result.count}`,
  });
  res.json({ ok: true, revoked: result.count });
});
