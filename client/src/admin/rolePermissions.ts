import type { AdminRole } from "../types";

/**
 * Mirrors the server-side requireRole(...) sets in server/src/app.ts — used
 * here only to filter nav links and gate client-side routing so an admin
 * never sees a page their role can't use. This is a UX convenience, not a
 * security boundary: every one of these routes is independently enforced
 * server-side regardless of what the client renders.
 */
export const ROUTE_ROLES = {
  dashboard: ["SUPER_ADMIN", "ADMIN"],
  cohorts: ["SUPER_ADMIN", "ADMIN"],
  students: ["SUPER_ADMIN", "ADMIN"],
  exams: ["SUPER_ADMIN", "ADMIN"],
  assignments: ["SUPER_ADMIN", "ADMIN"],
  results: ["SUPER_ADMIN", "ADMIN"],
  proctoring: ["SUPER_ADMIN", "ADMIN"],
  evidence: ["SUPER_ADMIN", "ADMIN"],
  assessor: ["SUPER_ADMIN", "ASSESSOR"],
  moderation: ["SUPER_ADMIN", "MODERATOR"],
  adminUsers: ["SUPER_ADMIN"],
} as const satisfies Record<string, AdminRole[]>;

export type RouteKey = keyof typeof ROUTE_ROLES;

export function canAccess(role: AdminRole, key: RouteKey): boolean {
  return (ROUTE_ROLES[key] as readonly AdminRole[]).includes(role);
}

/** Where to send an admin whose role has no business looking at "/". */
export function homePathFor(role: AdminRole): string {
  if (canAccess(role, "dashboard")) return "/";
  if (canAccess(role, "assessor")) return "/assessor/practical";
  if (canAccess(role, "moderation")) return "/moderation";
  return "/unauthorized";
}
