import { Router } from "express";
import { prisma } from "../prisma.js";

export const otpDeliveryFailuresRouter = Router();

/**
 * Admin-facing, read-only list of redacted OTP delivery failures — for
 * troubleshooting "is real delivery working" without ever surfacing raw
 * provider error text, student contact details, or OTP codes. Returns only
 * the student's internal ID (not email/phone) — look the student up via the
 * existing /api/students/:id if you need their contact details.
 */
otpDeliveryFailuresRouter.get("/", async (_req, res) => {
  const rows = await prisma.otpDeliveryFailure.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      correlationId: true,
      studentId: true,
      channel: true,
      provider: true,
      category: true,
      createdAt: true,
    },
  });
  res.json(rows);
});
