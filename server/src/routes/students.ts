import { Router } from "express";
import { prisma } from "../prisma.js";
import { normalizePhoneToE164 } from "../lib/phone.js";
import { recordAuditLog } from "../lib/auditLog.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";

export const studentsRouter = Router();

type ParsedStudentBody =
  | { ok: true; data: { firstName: string; lastName: string; email: string; phone: string | null; cohortId: string } }
  | { ok: false; error: string };

/**
 * Phone is validated and normalized to E.164 here — on create/edit only.
 * This never touches any other student's existing phone value; there is no
 * bulk-normalization pass anywhere in this codebase.
 */
function parseStudentBody(body: Record<string, unknown>): ParsedStudentBody {
  const { firstName, lastName, email, phone, cohortId } = body;
  if (
    typeof firstName !== "string" ||
    typeof lastName !== "string" ||
    typeof email !== "string" ||
    typeof cohortId !== "string"
  ) {
    return { ok: false, error: "Invalid student payload" };
  }
  if (!firstName.trim() || !lastName.trim() || !email.trim() || !cohortId.trim()) {
    return { ok: false, error: "Invalid student payload" };
  }

  let phoneVal: string | null = null;
  if (phone !== undefined && phone !== null && phone !== "") {
    if (typeof phone !== "string") {
      return { ok: false, error: "Invalid phone number" };
    }
    const normalized = normalizePhoneToE164(phone);
    if (!normalized.ok) {
      return { ok: false, error: normalized.error };
    }
    phoneVal = normalized.e164;
  }

  return {
    ok: true,
    data: {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      phone: phoneVal,
      cohortId: cohortId.trim(),
    },
  };
}

studentsRouter.get("/", async (_req, res) => {
  const students = await prisma.student.findMany({
    include: { cohort: true },
    orderBy: { lastName: "asc" },
  });
  res.json(students);
});

studentsRouter.get("/:id", async (req, res) => {
  const student = await prisma.student.findUnique({
    where: { id: req.params.id },
    include: { cohort: true },
  });
  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  res.json(student);
});

studentsRouter.post("/", async (req: AuthedAdminRequest, res) => {
  const parsed = parseStudentBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const student = await prisma.student.create({
      data: parsed.data,
      include: { cohort: true },
    });
    await recordAuditLog({ adminId: req.admin!.id, action: "STUDENT_CREATED", targetType: "Student", targetId: student.id });
    res.status(201).json(student);
  } catch {
    res.status(400).json({ error: "Email or phone already registered, or invalid cohort" });
  }
});

studentsRouter.put("/:id", async (req: AuthedAdminRequest, res) => {
  const parsed = parseStudentBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const student = await prisma.student.update({
      where: { id: req.params.id },
      data: parsed.data,
      include: { cohort: true },
    });
    await recordAuditLog({ adminId: req.admin!.id, action: "STUDENT_UPDATED", targetType: "Student", targetId: student.id });
    res.json(student);
  } catch {
    res.status(404).json({ error: "Student not found or duplicate email/phone" });
  }
});

studentsRouter.delete("/:id", async (req: AuthedAdminRequest, res) => {
  try {
    await prisma.student.delete({ where: { id: req.params.id } });
    await recordAuditLog({ adminId: req.admin!.id, action: "STUDENT_DELETED", targetType: "Student", targetId: req.params.id });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: "Student not found" });
  }
});

/** Admin: revoke every active session for a student (e.g. after suspected
 * credential/session sharing). Does not touch OTP tokens or any other data. */
studentsRouter.post("/:id/revoke-sessions", async (req: AuthedAdminRequest, res) => {
  const result = await prisma.studentSession.deleteMany({ where: { studentId: req.params.id } });
  await recordAuditLog({
    adminId: req.admin!.id,
    action: "STUDENT_SESSIONS_REVOKED",
    targetType: "Student",
    targetId: req.params.id,
    detail: `revoked=${result.count}`,
  });
  res.json({ ok: true, revoked: result.count });
});
