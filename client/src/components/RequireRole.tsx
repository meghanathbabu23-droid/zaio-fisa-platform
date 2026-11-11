import type { ReactNode } from "react";
import { useAdminAuth } from "../admin/AdminAuthContext";
import { canAccess, type RouteKey } from "../admin/rolePermissions";
import { Unauthorized } from "./Unauthorized";

/**
 * Client-side convenience only — hides pages an admin's role can't use so
 * they don't bounce off a wall of 403s from every API call on the page.
 * Every underlying route is independently enforced server-side regardless
 * of this check (see server/src/app.ts), so this is never the real
 * security boundary.
 */
export function RequireRole({ route, children }: { route: RouteKey; children: ReactNode }) {
  const { admin } = useAdminAuth();
  if (!admin || !canAccess(admin.role, route)) {
    return <Unauthorized />;
  }
  return <>{children}</>;
}
