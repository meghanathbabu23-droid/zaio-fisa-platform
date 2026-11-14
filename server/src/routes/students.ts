import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma, DB_PROVIDER } from "../prisma.js";
import { normalizePhoneToE164 } from "../lib/phone.js";
import { recordAuditLog } from "../lib/auditLog.js";
import {
  buildPhoneCreateField,
  buildSqlitePhoneUpdateField,
  buildMongoPhoneUpdateField,
} from "../lib/studentPhone.js";
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
  const { phone, ...rest } = parsed.data;
  try {
    const student = await prisma.student.create({
      // buildPhoneCreateField omits the key entirely when there's no
      // phone, rather than writing an explicit `phone: null` — required
      // for MongoDB's sparse unique index, and an equivalent no-op on
      // SQLite (an undefaulted optional column with no key in `data`
      // ends up NULL either way). Safe and correct on both backends, so
      // no DB_PROVIDER branch is needed for create.
      data: { ...rest, ...buildPhoneCreateField(phone) },
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
  const { phone, ...rest } = parsed.data;
  // DB_PROVIDER is read once at boot from ACTIVE_DB_PROVIDER (src/prisma.ts)
  // and reflects whichever client is actually active in this process —
  // "sqlite" locally/in tests (the default), "mongodb" once a deployment
  // sets ACTIVE_DB_PROVIDER=mongodb, at which point src/prisma.ts has
  // already swapped `prisma` itself to the Mongo-generated client and this
  // branch runs for real, writing the `{ unset: true }` shape instead of
  // an explicit `phone: null`. Both branches are exercised by this
  // codebase's own tests (students.test.ts for SQLite,
  // studentPhone.mongomemory.check.ts for MongoDB) against their
  // respective real generated clients. The cast below is required because
  // MongoDB's `{ unset: true }` operator has no equivalent shape in the
  // SQLite-generated client's NullableStringFieldUpdateOperationsInput
  // (verified: it only has `set`) — there is no type that is natively
  // valid for both backends.
  const phoneField =
    DB_PROVIDER === "mongodb" ? buildMongoPhoneUpdateField(phone) : buildSqlitePhoneUpdateField(phone);
  try {
    const student = await prisma.student.update({
      where: { id: req.params.id },
      data: { ...rest, ...phoneField } as Prisma.StudentUpdateInput,
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
