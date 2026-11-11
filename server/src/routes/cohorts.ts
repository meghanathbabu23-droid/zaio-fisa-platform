import { Router } from "express";
import { AdminRole } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireRole } from "../middleware/requireRole.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";
import { recordAuditLog } from "../lib/auditLog.js";

export const cohortsRouter = Router();

function parseCohortBody(body: Record<string, unknown>) {
  const { name, programme, startDate, examDate, zoomLink } = body;
  if (
    typeof name !== "string" ||
    typeof programme !== "string" ||
    typeof startDate !== "string" ||
    typeof examDate !== "string" ||
    typeof zoomLink !== "string"
  ) {
    return null;
  }
  const start = new Date(startDate);
  const exam = new Date(examDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(exam.getTime())) {
    return null;
  }
  if (!name.trim() || !programme.trim() || !zoomLink.trim()) {
    return null;
  }
  return {
    name: name.trim(),
    programme: programme.trim(),
    startDate: start,
    examDate: exam,
    zoomLink: zoomLink.trim(),
  };
}

cohortsRouter.get("/", async (_req, res) => {
  const cohorts = await prisma.cohort.findMany({
    orderBy: { startDate: "desc" },
  });
  res.json(cohorts);
});

cohortsRouter.get("/:id", async (req, res) => {
  const cohort = await prisma.cohort.findUnique({ where: { id: req.params.id } });
  if (!cohort) {
    res.status(404).json({ error: "Cohort not found" });
    return;
  }
  res.json(cohort);
});

cohortsRouter.post("/", async (req: AuthedAdminRequest, res) => {
  const data = parseCohortBody(req.body);
  if (!data) {
    res.status(400).json({ error: "Invalid cohort payload" });
    return;
  }
  const cohort = await prisma.cohort.create({ data });
  await recordAuditLog({ adminId: req.admin!.id, action: "COHORT_CREATED", targetType: "Cohort", targetId: cohort.id });
  res.status(201).json(cohort);
});

cohortsRouter.put("/:id", async (req: AuthedAdminRequest, res) => {
  const data = parseCohortBody(req.body);
  if (!data) {
    res.status(400).json({ error: "Invalid cohort payload" });
    return;
  }
  try {
    const cohort = await prisma.cohort.update({
      where: { id: req.params.id },
      data,
    });
    await recordAuditLog({ adminId: req.admin!.id, action: "COHORT_UPDATED", targetType: "Cohort", targetId: cohort.id });
    res.json(cohort);
  } catch {
    res.status(404).json({ error: "Cohort not found" });
  }
});

/**
 * Admin toggle for real email/SMS OTP delivery eligibility. Real delivery for
 * any student in this cohort still also requires the server-wide
 * OTP_DELIVERY_MODE=live — this flag alone never sends anything by itself.
 * Does not touch Student.emailVerifiedAt/phoneVerifiedAt — enabling this is
 * not the same as a contact detail having been verified. SUPER_ADMIN only —
 * tighter than the rest of this router, which ADMIN can also use — because
 * this is system-level security configuration, not routine cohort upkeep.
 */
cohortsRouter.put("/:id/otp-eligibility", requireRole(AdminRole.SUPER_ADMIN), async (req: AuthedAdminRequest, res) => {
  const { eligible } = req.body as Record<string, unknown>;
  if (typeof eligible !== "boolean") {
    res.status(400).json({ error: "'eligible' must be a boolean" });
    return;
  }
  try {
    const cohort = await prisma.cohort.update({
      where: { id: req.params.id },
      data: { realOtpEligible: eligible },
    });
    await recordAuditLog({
      adminId: req.admin!.id,
      action: "COHORT_OTP_ELIGIBILITY_CHANGED",
      targetType: "Cohort",
      targetId: cohort.id,
      detail: `eligible=${cohort.realOtpEligible}`,
    });
    res.json({ id: cohort.id, realOtpEligible: cohort.realOtpEligible });
  } catch {
    res.status(404).json({ error: "Cohort not found" });
  }
});

cohortsRouter.delete("/:id", async (req: AuthedAdminRequest, res) => {
  try {
    await prisma.cohort.delete({ where: { id: req.params.id } });
    await recordAuditLog({ adminId: req.admin!.id, action: "COHORT_DELETED", targetType: "Cohort", targetId: req.params.id });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: "Cohort not found" });
  }
});
