import {
  ProctoringCaptureTier,
  ProctoringRecordingKind,
  ProctoringSessionStatus,
} from "@prisma/client";
import { Router } from "express";
import { prisma } from "../prisma.js";
import { type AuthedRequest, requireStudent } from "../middleware/studentAuth.js";
import { recordingPath, saveRecordingFile } from "../lib/recordingStorage.js";
import {
  classifyRecordingBuffer,
  MIN_VERIFIED_REAL_BYTES,
  webcamStatusAfterUpload,
} from "../lib/recordingVerify.js";

export const proctoringStudentRouter = Router();
export const proctoringAdminRouter = Router();

proctoringStudentRouter.use(requireStudent);

async function assertAssignment(studentId: string, assignmentId: string) {
  return prisma.examAssignment.findFirst({
    where: { id: assignmentId, studentId },
    include: { exam: true },
  });
}

proctoringStudentRouter.post("/sessions", async (req: AuthedRequest, res) => {
  const { assignmentId } = req.body as { assignmentId?: string };
  if (typeof assignmentId !== "string") {
    res.status(400).json({ error: "assignmentId required" });
    return;
  }
  const assignment = await assertAssignment(req.studentId!, assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }

  const session = await prisma.proctoringSession.create({
    data: {
      assignmentId,
      studentId: req.studentId!,
      status: ProctoringSessionStatus.SETUP,
      simulatedDemo: true,
    },
  });

  await prisma.proctoringEvent.create({
    data: {
      sessionId: session.id,
      type: "SESSION_CREATED",
      message: "Proctoring session created (demo storage). Monitoring is advisory only.",
    },
  });

  res.status(201).json({
    sessionId: session.id,
    simulatedDemo: true,
    sebNote:
      "For production, distribute a Safe Exam Browser config that allowlists this origin and disables restricted shortcuts.",
    zoomSecondCamera:
      "Position a second device (phone) on Zoom showing your workspace; keep it in frame for the duration of the exam.",
  });
});

proctoringStudentRouter.post("/sessions/:sessionId/activate", async (req: AuthedRequest, res) => {
  const { webcamRecording, screenRecording } = req.body as {
    webcamRecording?: boolean;
    screenRecording?: boolean;
  };
  const session = await prisma.proctoringSession.findFirst({
    where: { id: req.params.sessionId, studentId: req.studentId! },
  });
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const webcamActive = webcamRecording === true;
  const screenActive = screenRecording === true;
  const updated = await prisma.proctoringSession.update({
    where: { id: session.id },
    data: {
      status: ProctoringSessionStatus.ACTIVE,
      webcamStatus: webcamActive ? "capturing_real" : "unavailable",
      screenStatus: screenActive ? "capturing_real" : "not_requested",
    },
  });
  res.json({
    ...updated,
    realWebcamCapture: webcamActive,
    realScreenCapture: screenActive,
    simulatedDemo: true,
  });
});

proctoringStudentRouter.post("/sessions/:sessionId/events", async (req: AuthedRequest, res) => {
  const { type, message } = req.body as { type?: string; message?: string };
  if (typeof type !== "string" || typeof message !== "string") {
    res.status(400).json({ error: "type and message required" });
    return;
  }
  const session = await prisma.proctoringSession.findFirst({
    where: { id: req.params.sessionId, studentId: req.studentId! },
  });
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const event = await prisma.proctoringEvent.create({
    data: {
      sessionId: session.id,
      type: type.slice(0, 64),
      message: message.slice(0, 2000),
      advisory: true,
    },
  });
  await prisma.proctoringSession.update({
    where: { id: session.id },
    data: { updatedAt: new Date() },
  });
  res.status(201).json({
    id: event.id,
    createdAt: event.createdAt.toISOString(),
    advisory: true,
  });
});

proctoringStudentRouter.post("/sessions/:sessionId/end", async (req: AuthedRequest, res) => {
  const session = await prisma.proctoringSession.findFirst({
    where: { id: req.params.sessionId, studentId: req.studentId! },
  });
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await prisma.proctoringSession.update({
    where: { id: session.id },
    data: { status: ProctoringSessionStatus.ENDED, endedAt: new Date() },
  });
  res.json({ ok: true });
});

proctoringStudentRouter.post("/sessions/:sessionId/recordings", async (req: AuthedRequest, res) => {
  const { kind, mimeType, dataBase64 } = req.body as {
    kind?: string;
    mimeType?: string;
    dataBase64?: string;
  };
  if (kind !== "WEBCAM_MIC" && kind !== "SCREEN") {
    res.status(400).json({ error: "kind must be WEBCAM_MIC or SCREEN" });
    return;
  }
  if (typeof mimeType !== "string" || typeof dataBase64 !== "string") {
    res.status(400).json({ error: "mimeType and dataBase64 required" });
    return;
  }
  const session = await prisma.proctoringSession.findFirst({
    where: { id: req.params.sessionId, studentId: req.studentId! },
  });
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(dataBase64, "base64");
  } catch {
    res.status(400).json({ error: "Invalid base64" });
    return;
  }
  if (buffer.length > 20 * 1024 * 1024) {
    res.status(413).json({ error: "Demo limit: max 20MB per recording" });
    return;
  }

  const captureTier = classifyRecordingBuffer(buffer);
  if (captureTier === ProctoringCaptureTier.INVALID_EMPTY) {
    res.status(400).json({
      error: "Empty recording — upload rejected",
      captureTier,
    });
    return;
  }

  const ext = mimeType.includes("webm") ? "webm" : "bin";
  const filename = `${kind.toLowerCase()}-${Date.now()}.${ext}`;
  await saveRecordingFile(session.id, filename, buffer);

  const record = await prisma.proctoringRecording.create({
    data: {
      sessionId: session.id,
      kind: kind as ProctoringRecordingKind,
      filename,
      mimeType,
      sizeBytes: buffer.length,
      captureTier,
    },
  });

  const statusField = kind === "WEBCAM_MIC" ? "webcamStatus" : "screenStatus";
  await prisma.proctoringSession.update({
    where: { id: session.id },
    data: { [statusField]: webcamStatusAfterUpload(captureTier) },
  });

  await prisma.proctoringEvent.create({
    data: {
      sessionId: session.id,
      type:
        captureTier === ProctoringCaptureTier.VERIFIED_REAL
          ? "RECORDING_UPLOAD_VERIFIED"
          : "RECORDING_UPLOAD_UNVERIFIED",
      message:
        captureTier === ProctoringCaptureTier.VERIFIED_REAL
          ? `Stored ${buffer.length} bytes (size threshold met; not validated as playable A/V).`
          : `Stored ${buffer.length} bytes below ${MIN_VERIFIED_REAL_BYTES}B — not treated as verified real evidence.`,
      advisory: true,
    },
  });

  res.status(201).json({
    id: record.id,
    filename,
    sizeBytes: record.sizeBytes,
    captureTier: record.captureTier,
    storedPath: recordingPath(session.id, filename),
    simulatedDemo: true,
    verifiedReal: captureTier === ProctoringCaptureTier.VERIFIED_REAL,
    note: "Demo disk storage — not a certified proctoring vault.",
  });
});

proctoringAdminRouter.get("/sessions", async (req, res) => {
  const activeOnly = req.query.active === "true";
  const sessions = await prisma.proctoringSession.findMany({
    where: activeOnly
      ? { status: ProctoringSessionStatus.ACTIVE }
      : undefined,
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 5 },
      recordings: true,
      _count: { select: { events: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const assignmentIds = [...new Set(sessions.map((s) => s.assignmentId))];
  const assignments = await prisma.examAssignment.findMany({
    where: { id: { in: assignmentIds } },
    include: { student: true, exam: true },
  });
  const byId = Object.fromEntries(assignments.map((a) => [a.id, a]));

  res.json({
    simulatedDemo: true,
    sessions: sessions.map((s) => ({
      id: s.id,
      assignmentId: s.assignmentId,
      studentName: byId[s.assignmentId]
        ? `${byId[s.assignmentId].student.firstName} ${byId[s.assignmentId].student.lastName}`
        : "—",
      examTitle: byId[s.assignmentId]?.exam.title ?? "—",
      status: s.status,
      webcamStatus: s.webcamStatus,
      screenStatus: s.screenStatus,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
      eventCount: s._count.events,
      recentEvents: s.events.map((e) => ({
        type: e.type,
        message: e.message,
        createdAt: e.createdAt.toISOString(),
        advisory: e.advisory,
      })),
      recordings: s.recordings.map((r) => ({
        kind: r.kind,
        filename: r.filename,
        sizeBytes: r.sizeBytes,
        captureTier: r.captureTier,
        verifiedReal: r.captureTier === ProctoringCaptureTier.VERIFIED_REAL,
        storedAt: r.storedAt.toISOString(),
      })),
    })),
  });
});

proctoringAdminRouter.get("/sessions/:sessionId", async (req, res) => {
  const session = await prisma.proctoringSession.findUnique({
    where: { id: req.params.sessionId },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      recordings: true,
    },
  });
  if (!session) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const assignment = await prisma.examAssignment.findUnique({
    where: { id: session.assignmentId },
    include: { student: true, exam: true },
  });
  res.json({ session, assignment, simulatedDemo: true });
});
