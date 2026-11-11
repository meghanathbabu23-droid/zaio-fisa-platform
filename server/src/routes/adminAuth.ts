import { randomBytes, createHash } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../prisma.js";
import { adminAuthConfig, isStrongPassword, SESSION_COOKIE } from "../lib/adminAuthConfig.js";
import { hashPassword, verifyPassword } from "../lib/adminPassword.js";
import { createAdminSession, clearAdminSessionCookies } from "../lib/adminSession.js";
import { requireAdminAuth, type AuthedAdminRequest } from "../middleware/requireAdminAuth.js";
import { recordAuditLog } from "../lib/auditLog.js";
import { getEmailProvider } from "../lib/providers/index.js";

export const adminAuthRouter = Router();

const GENERIC_LOGIN_ERROR = "Invalid email or password.";
const GENERIC_RESET_REQUEST_MESSAGE = "If that email is registered, a password reset link has been sent.";

export const adminLoginIpLimiter = rateLimit({
  windowMs: adminAuthConfig.loginIpLimitWindowMs,
  limit: adminAuthConfig.loginIpLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait and try again." },
});

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

adminAuthRouter.post("/login", adminLoginIpLimiter, async (req, res) => {
  const { email, password } = req.body as Record<string, unknown>;
  const emailStr = typeof email === "string" ? email.trim().toLowerCase() : "";
  const passwordStr = typeof password === "string" ? password : "";
  if (!emailStr || !passwordStr) {
    res.status(400).json({ error: "Email and password required." });
    return;
  }

  const admin = await prisma.administrator.findUnique({ where: { email: emailStr } });

  // Locked-account feedback is a deliberate, narrow exception to "generic
  // errors reduce enumeration": by the time an account is locked, 5 failed
  // guesses have already happened, so the account's existence is already
  // strongly implied. Telling a legitimate admin "you're locked out, wait"
  // instead of an endless wrong-password loop is worth that small residual
  // risk. A nonexistent email can never be "locked", so this branch alone
  // never fires for one.
  if (admin && admin.lockedUntil && admin.lockedUntil > new Date()) {
    res.status(423).json({ error: "Account temporarily locked. Try again later." });
    return;
  }

  if (!admin || !admin.active || !(await verifyPassword(passwordStr, admin.passwordHash))) {
    if (admin) {
      const attempts = admin.failedLoginAttempts + 1;
      const locked = attempts >= adminAuthConfig.maxFailedLoginAttempts;
      await prisma.administrator.update({
        where: { id: admin.id },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil: locked ? new Date(Date.now() + adminAuthConfig.lockoutMs) : null,
        },
      });
      await recordAuditLog({
        adminId: admin.id,
        action: locked ? "LOGIN_FAILED_LOCKED" : "LOGIN_FAILED",
        targetType: "Administrator",
        targetId: admin.id,
      });
    }
    res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    return;
  }

  await prisma.administrator.update({
    where: { id: admin.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await createAdminSession(res, admin.id, req.header("user-agent") ?? "");
  await recordAuditLog({ adminId: admin.id, action: "LOGIN_SUCCESS", targetType: "Administrator", targetId: admin.id });

  res.json({ id: admin.id, fullName: admin.fullName, email: admin.email, role: admin.role });
});

adminAuthRouter.post("/logout", requireAdminAuth, async (req: AuthedAdminRequest, res) => {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) {
    await prisma.adminSession.deleteMany({ where: { token } });
  }
  clearAdminSessionCookies(res);
  await recordAuditLog({ adminId: req.admin!.id, action: "LOGOUT", targetType: "Administrator", targetId: req.admin!.id });
  res.status(204).send();
});

adminAuthRouter.get("/me", requireAdminAuth, (req: AuthedAdminRequest, res) => {
  res.json(req.admin);
});

adminAuthRouter.post("/change-password", requireAdminAuth, async (req: AuthedAdminRequest, res) => {
  const { currentPassword, newPassword } = req.body as Record<string, unknown>;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    res.status(400).json({ error: "currentPassword and newPassword required." });
    return;
  }
  const admin = await prisma.administrator.findUniqueOrThrow({ where: { id: req.admin!.id } });
  if (!(await verifyPassword(currentPassword, admin.passwordHash))) {
    res.status(401).json({ error: "Current password is incorrect." });
    return;
  }
  const strength = isStrongPassword(newPassword);
  if (!strength.ok) {
    res.status(400).json({ error: strength.reason });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  const currentToken = req.cookies?.[SESSION_COOKIE] as string;
  await prisma.$transaction([
    prisma.administrator.update({ where: { id: admin.id }, data: { passwordHash, passwordChangedAt: new Date() } }),
    // Revoke every other session for this admin — keep the current one so
    // they aren't logged out by their own password change.
    prisma.adminSession.deleteMany({ where: { adminId: admin.id, token: { not: currentToken } } }),
  ]);
  await recordAuditLog({ adminId: admin.id, action: "PASSWORD_CHANGED", targetType: "Administrator", targetId: admin.id });
  res.json({ ok: true });
});

const resetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait and try again." },
});

function renderPasswordResetEmail(resetUrl: string, expiresAt: Date) {
  const minutes = Math.round((expiresAt.getTime() - Date.now()) / 60000);
  const subject = "Reset your Zaio FISA admin password";
  const text =
    `A password reset was requested for your Zaio FISA admin account.\n\n${resetUrl}\n\n` +
    `This link expires in ${minutes} minutes. If you didn't request this, you can ignore this email.`;
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #666970;">Zaio FISA admin</p>
      <h1 style="font-family: 'Space Grotesk', Arial, sans-serif; font-size: 22px; color: #101116;">Reset your password</h1>
      <p style="font-size: 14px; color: #313339;">
        <a href="${resetUrl}" style="color: #2B2ECF;">Click here to reset your password</a> — expires in ${minutes} minutes.
      </p>
      <p style="font-size: 13px; color: #666970;">If you didn't request this, you can safely ignore this email.</p>
    </div>`;
  return { subject, text, html };
}

adminAuthRouter.post("/password-reset/request", resetRequestLimiter, async (req, res) => {
  const { email } = req.body as Record<string, unknown>;
  const emailStr = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!emailStr) {
    res.status(400).json({ error: "Email required." });
    return;
  }

  const admin = await prisma.administrator.findUnique({ where: { email: emailStr } });
  if (admin && admin.active) {
    const rawToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + adminAuthConfig.passwordResetTtlMs);
    await prisma.adminPasswordResetToken.create({
      data: { tokenHash: hashToken(rawToken), adminId: admin.id, expiresAt },
    });
    const resetUrl = `${process.env.ADMIN_WEB_ORIGIN ?? "http://localhost:5173"}/admin/reset-password?token=${rawToken}`;
    const { subject, text, html } = renderPasswordResetEmail(resetUrl, expiresAt);
    const result = await getEmailProvider().sendEmail(admin.email, subject, text, html);
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error(`[admin] password reset email delivery failed category=${result.category}`);
    }
    await recordAuditLog({ adminId: admin.id, action: "PASSWORD_RESET_REQUESTED", targetType: "Administrator", targetId: admin.id });
  }

  // Always the same response, whether or not the email was registered.
  res.json({ ok: true, message: GENERIC_RESET_REQUEST_MESSAGE });
});

adminAuthRouter.post("/password-reset/confirm", async (req, res) => {
  const { token, newPassword } = req.body as Record<string, unknown>;
  if (typeof token !== "string" || typeof newPassword !== "string") {
    res.status(400).json({ error: "token and newPassword required." });
    return;
  }

  const record = await prisma.adminPasswordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    res.status(400).json({ error: "Invalid or expired reset link." });
    return;
  }

  const strength = isStrongPassword(newPassword);
  if (!strength.ok) {
    res.status(400).json({ error: strength.reason });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.administrator.update({
      where: { id: record.adminId },
      data: { passwordHash, passwordChangedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    }),
    prisma.adminPasswordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.adminSession.deleteMany({ where: { adminId: record.adminId } }),
  ]);
  await recordAuditLog({ adminId: record.adminId, action: "PASSWORD_RESET_CONFIRMED", targetType: "Administrator", targetId: record.adminId });
  res.json({ ok: true });
});
