import { prisma } from "../prisma.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";

/**
 * evidence.ts sits fully behind requireAdminAuth, so req.admin is always
 * populated by the time this runs — the actor label is the real admin's
 * email, not a client-suppliable header (that would let the label be
 * spoofed independent of who actually authenticated).
 */
export function demoActorLabel(req: AuthedAdminRequest): string {
  return req.admin?.email ?? "unknown-admin";
}

export async function logEvidenceAudit(
  evidenceId: string,
  action: string,
  detail: string,
  actorLabel: string
) {
  await prisma.evidenceAuditLog.create({
    data: { evidenceId, action, detail, actorLabel },
  });
}
