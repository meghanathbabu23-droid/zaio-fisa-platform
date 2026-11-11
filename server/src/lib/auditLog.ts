import { prisma } from "../prisma.js";

/**
 * Records an administrative action. Never pass a password, OTP, API key, or
 * session token into `detail` — this is a hard rule, not just a convention,
 * since these rows are readable by any SUPER_ADMIN via the admin UI.
 */
export async function recordAuditLog(params: {
  adminId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: string;
}): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      adminId: params.adminId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      detail: params.detail ?? "",
    },
  });
}
