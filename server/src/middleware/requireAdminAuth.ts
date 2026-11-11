import type { Request, Response, NextFunction } from "express";
import type { AdminRole } from "@prisma/client";
import { prisma } from "../prisma.js";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "../lib/adminAuthConfig.js";

export type AuthedAdminRequest = Request & {
  admin?: { id: string; role: AdminRole; email: string; fullName: string };
};

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Cookie-session auth for administrators — completely separate from
 * requireStudent (Bearer token). Also enforces CSRF via the stateless
 * double-submit pattern for any state-changing request: the non-httpOnly
 * fisa_admin_csrf cookie must match the X-CSRF-Token header exactly. GET/HEAD
 * requests don't carry side effects, so they're exempt from the CSRF check
 * (standard practice), but still require a valid session.
 */
export async function requireAdminAuth(req: AuthedAdminRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Admin authentication required" });
    return;
  }

  const session = await prisma.adminSession.findUnique({ where: { token }, include: { admin: true } });
  if (!session || session.expiresAt < new Date() || !session.admin.active) {
    res.status(401).json({ error: "Admin authentication required" });
    return;
  }

  if (MUTATING_METHODS.has(req.method)) {
    const csrfCookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
    const csrfHeader = req.header(CSRF_HEADER);
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      res.status(403).json({ error: "CSRF token missing or invalid" });
      return;
    }
  }

  req.admin = {
    id: session.admin.id,
    role: session.admin.role,
    email: session.admin.email,
    fullName: session.admin.fullName,
  };
  next();
}
