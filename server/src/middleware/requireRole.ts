import type { Response, NextFunction } from "express";
import type { AdminRole } from "@prisma/client";
import type { AuthedAdminRequest } from "./requireAdminAuth.js";

/** Must run AFTER requireAdminAuth (relies on req.admin being set). Returns
 * 403, not 401 — the caller is authenticated, just not permitted. */
export function requireRole(...roles: AdminRole[]) {
  return (req: AuthedAdminRequest, res: Response, next: NextFunction): void => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      res.status(403).json({ error: "Not permitted for your role" });
      return;
    }
    next();
  };
}
