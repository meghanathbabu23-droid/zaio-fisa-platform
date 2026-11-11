import { randomBytes } from "node:crypto";
import type { Response } from "express";
import { prisma } from "../prisma.js";
import { CSRF_COOKIE, SESSION_COOKIE, adminAuthConfig } from "./adminAuthConfig.js";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function baseCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeMs,
  };
}

/** Creates a new AdminSession row and sets both the httpOnly session cookie
 * and the readable CSRF cookie on the response. Returns nothing sensitive —
 * the caller never sees the raw token. */
export async function createAdminSession(res: Response, adminId: string, userAgent: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + adminAuthConfig.sessionTtlMs);

  await prisma.adminSession.create({
    data: { token, adminId, userAgent, expiresAt },
  });

  res.cookie(SESSION_COOKIE, token, baseCookieOptions(adminAuthConfig.sessionTtlMs));
  // CSRF cookie is deliberately NOT httpOnly — the frontend must be able to
  // read it and echo it back in a header on mutating requests.
  res.cookie(CSRF_COOKIE, csrfToken, { ...baseCookieOptions(adminAuthConfig.sessionTtlMs), httpOnly: false });
}

export function clearAdminSessionCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(CSRF_COOKIE, { path: "/" });
}
