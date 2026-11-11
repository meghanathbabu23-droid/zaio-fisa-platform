import {
  EvidenceArtifactKind,
  type EvidenceArtifactStatus,
} from "@prisma/client";
import { Router } from "express";
import { createReadStream } from "node:fs";
import path from "node:path";
import { prisma } from "../prisma.js";
import { demoActorLabel, logEvidenceAudit } from "../lib/evidenceAudit.js";
import {
  backfillEvidenceRecords,
  ensureEvidenceRecord,
  resolveSafeRecordingPath,
  syncEvidenceForAssignment,
} from "../lib/evidenceSync.js";
import { recordAuditLog } from "../lib/auditLog.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";

export const evidenceRouter = Router();

function parseStatusFilter(raw: string | undefined): EvidenceArtifactStatus | undefined {
  if (raw === "PRESENT" || raw === "MISSING" || raw === "SIMULATED") return raw;
  return undefined;
}

evidenceRouter.post("/sync", async (req, res) => {
  const count = await backfillEvidenceRecords();
  res.json({ ok: true, assignmentsSynced: count, note: "Artifacts index refreshed; source records unchanged." });
});

evidenceRouter.get("/", async (req, res) => {
  const cohortId = typeof req.query.cohortId === "string" ? req.query.cohortId : undefined;
  const studentId = typeof req.query.studentId === "string" ? req.query.studentId : undefined;
  const examId = typeof req.query.examId === "string" ? req.query.examId : undefined;
  const artifactStatus = parseStatusFilter(
    typeof req.query.artifactStatus === "string" ? req.query.artifactStatus : undefined
  );

  const assignments = await prisma.examAssignment.findMany({
    where: {
      student: cohortId ? { cohortId } : undefined,
      studentId,
      examId,
    },
    include: {
      exam: true,
      student: { include: { cohort: true } },
    },
    orderBy: { assignedAt: "desc" },
  });

  const rows = [];
  for (const a of assignments) {
    await ensureEvidenceRecord(a.id);
    const synced = await syncEvidenceForAssignment(a.id);
    if (!synced) continue;
    const artifacts = artifactStatus
      ? synced.artifacts.filter((x) => x.status === artifactStatus)
      : synced.artifacts;
    const missingCount = synced.artifacts.filter((x) => x.status === "MISSING").length;
    const simulatedCount = synced.artifacts.filter((x) => x.status === "SIMULATED").length;

    rows.push({
      assignmentId: a.id,
      cohort: { id: a.student.cohort.id, name: a.student.cohort.name },
      student: {
        id: a.student.id,
        firstName: a.student.firstName,
        lastName: a.student.lastName,
        email: a.student.email,
      },
      exam: { id: a.exam.id, title: a.exam.title, type: a.exam.type },
      submissionStatus: synced.submissionStatus,
      recordingStatus: synced.recordingStatus,
      assignedAt: a.assignedAt.toISOString(),
      lastSyncedAt: synced.lastSyncedAt.toISOString(),
      evidenceId: synced.id,
      artifactCount: synced.artifacts.length,
      missingCount,
      simulatedCount,
      artifacts: artifacts.map((art) => ({
        id: art.id,
        kind: art.kind,
        status: art.status,
        label: art.label,
        capturedAt: art.capturedAt?.toISOString() ?? null,
        downloadable: art.kind === EvidenceArtifactKind.PROCTORING_RECORDING && !!art.filePath,
      })),
    });
  }

  res.json({
    rows,
    demoNote: "Evidence indexes point at original records. Recordings stay on disk; flags show missing/simulated items.",
  });
});

evidenceRouter.get("/:assignmentId", async (req: AuthedAdminRequest, res) => {
  const assignmentId = req.params.assignmentId;
  await ensureEvidenceRecord(assignmentId);
  const synced = await syncEvidenceForAssignment(assignmentId);
  if (!synced) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }

  const assignment = await prisma.examAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      exam: true,
      student: { include: { cohort: true } },
      attempt: true,
      moderationCase: { include: { records: true } },
      assessorReview: true,
    },
  });
  if (!assignment) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }

  const actor = demoActorLabel(req);
  await logEvidenceAudit(synced.id, "VIEW", `Viewed evidence for assignment ${assignmentId}`, actor);
  await recordAuditLog({
    adminId: req.admin!.id,
    action: "EVIDENCE_VIEWED",
    targetType: "ExamAssignment",
    targetId: assignmentId,
  });

  const auditLogs = await prisma.evidenceAuditLog.findMany({
    where: { evidenceId: synced.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  res.json({
    assignment: {
      id: assignment.id,
      status: assignment.status,
      assignedAt: assignment.assignedAt.toISOString(),
    },
    cohort: assignment.student.cohort,
    student: {
      id: assignment.student.id,
      firstName: assignment.student.firstName,
      lastName: assignment.student.lastName,
      email: assignment.student.email,
    },
    exam: assignment.exam,
    evidence: {
      id: synced.id,
      submissionStatus: synced.submissionStatus,
      recordingStatus: synced.recordingStatus,
      lastSyncedAt: synced.lastSyncedAt.toISOString(),
      artifacts: synced.artifacts.map((a) => ({
        id: a.id,
        kind: a.kind,
        status: a.status,
        label: a.label,
        sourceRecordId: a.sourceRecordId,
        filePath: a.filePath,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        capturedAt: a.capturedAt?.toISOString() ?? null,
        meta: JSON.parse(a.metaJson || "{}") as Record<string, unknown>,
      })),
    },
    auditTrail: auditLogs.map((l) => ({
      id: l.id,
      action: l.action,
      actorLabel: l.actorLabel,
      detail: l.detail,
      createdAt: l.createdAt.toISOString(),
    })),
  });
});

evidenceRouter.get("/:assignmentId/summary-report", async (req: AuthedAdminRequest, res) => {
  const assignmentId = req.params.assignmentId;
  const format = req.query.format === "json" ? "json" : "json";
  const synced = await syncEvidenceForAssignment(assignmentId);
  if (!synced) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const detailRes = await prisma.examAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      exam: true,
      student: { include: { cohort: true } },
      attempt: true,
      workspace: { include: { submissions: { include: { autoAssessment: true } } } },
      assessorReview: true,
      moderationCase: { include: { records: true } },
    },
  });

  const sessions = await prisma.proctoringSession.findMany({
    where: { assignmentId },
    include: { events: true, recordings: true },
  });

  const actor = demoActorLabel(req);
  await logEvidenceAudit(
    synced.id,
    "EXPORT_SUMMARY",
    `Exported evidence summary (${format})`,
    actor
  );
  await recordAuditLog({
    adminId: req.admin!.id,
    action: "EVIDENCE_SUMMARY_EXPORTED",
    targetType: "ExamAssignment",
    targetId: assignmentId,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    disclaimer:
      "Demo evidence summary. Original database rows are authoritative; this report is an assembled view.",
    student: detailRes
      ? `${detailRes.student.firstName} ${detailRes.student.lastName}`
      : "",
    cohort: detailRes?.student.cohort.name ?? "",
    exam: detailRes?.exam.title ?? "",
    examType: detailRes?.exam.type ?? "",
    submissionStatus: synced.submissionStatus,
    recordingStatus: synced.recordingStatus,
    artifacts: synced.artifacts.map((a) => ({
      kind: a.kind,
      status: a.status,
      label: a.label,
      capturedAt: a.capturedAt?.toISOString() ?? null,
      meta: JSON.parse(a.metaJson || "{}"),
    })),
    mcq:
      detailRes?.attempt != null
        ? {
            scorePercent: detailRes.attempt.scorePercent,
            submittedAt: detailRes.attempt.submittedAt?.toISOString() ?? null,
            answers: detailRes.attempt.answers ? JSON.parse(detailRes.attempt.answers) : null,
          }
        : null,
    practicalSubmissions:
      detailRes?.workspace?.submissions.map((s) => ({
        id: s.id,
        submittedAt: s.submittedAt.toISOString(),
        isFinal: s.isFinal,
        automatedScore: s.autoAssessment?.scorePercent ?? null,
      })) ?? [],
    proctoring: sessions.map((s) => ({
      sessionId: s.id,
      status: s.status,
      simulatedDemo: s.simulatedDemo,
      events: s.events.length,
      recordings: s.recordings.map((r) => ({
        kind: r.kind,
        filename: r.filename,
        sizeBytes: r.sizeBytes,
      })),
    })),
    moderation: detailRes?.moderationCase
      ? {
          status: detailRes.moderationCase.status,
          flags: JSON.parse(detailRes.moderationCase.advisoryFlagsJson || "[]"),
          decisions: detailRes.moderationCase.records.map((r) => ({
            moderator: r.moderatorName,
            decision: r.decision,
            at: r.createdAt.toISOString(),
          })),
        }
      : null,
    assessorReview: detailRes?.assessorReview ?? null,
  };

  if (format === "json") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="evidence-summary-${assignmentId}.json"`
    );
    res.send(JSON.stringify(report, null, 2));
  }
});

evidenceRouter.get("/:assignmentId/artifacts/:artifactId/download", async (req: AuthedAdminRequest, res) => {
  const { assignmentId, artifactId } = req.params;
  const record = await prisma.evidenceRecord.findUnique({
    where: { assignmentId },
    include: { artifacts: true },
  });
  if (!record) {
    res.status(404).json({ error: "Evidence not found" });
    return;
  }
  const artifact = record.artifacts.find((a) => a.id === artifactId);
  if (!artifact) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }

  const actor = demoActorLabel(req);
  await logEvidenceAudit(
    record.id,
    "DOWNLOAD",
    `Download ${artifact.kind} (${artifact.label})`,
    actor
  );
  await recordAuditLog({
    adminId: req.admin!.id,
    action: "EVIDENCE_DOWNLOADED",
    targetType: "EvidenceArtifact",
    targetId: artifactId,
    detail: `kind=${artifact.kind}`,
  });

  if (artifact.kind === EvidenceArtifactKind.PROCTORING_RECORDING && artifact.filePath) {
    const safe = resolveSafeRecordingPath(artifact.filePath);
    if (!safe) {
      res.status(400).json({ error: "Invalid file path" });
      return;
    }
    const mime = artifact.mimeType ?? "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(safe)}"`);
    const stream = createReadStream(safe);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.status(404).json({ error: "File not found on disk" });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
    return;
  }

  const assignment = await prisma.examAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      attempt: true,
      workspace: { include: { submissions: true } },
      assessorReview: true,
      moderationCase: { include: { records: true } },
    },
  });

  let payload: unknown;
  let filename: string;
  let contentType = "application/json";

  switch (artifact.kind) {
    case EvidenceArtifactKind.MCQ_ATTEMPT:
      filename = `mcq-${assignmentId}.json`;
      payload = {
        attemptId: assignment?.attempt?.id ?? null,
        answers: assignment?.attempt?.answers ? JSON.parse(assignment.attempt.answers) : null,
        scorePercent: assignment?.attempt?.scorePercent ?? null,
        submittedAt: assignment?.attempt?.submittedAt?.toISOString() ?? null,
      };
      break;
    case EvidenceArtifactKind.PRACTICAL_SUBMISSION: {
      const sub = assignment?.workspace?.submissions.find((s) => s.id === artifact.sourceRecordId);
      filename = `practical-${artifact.sourceRecordId}.json`;
      payload = sub
        ? {
            submissionId: sub.id,
            submittedAt: sub.submittedAt.toISOString(),
            isFinal: sub.isFinal,
            files: JSON.parse(sub.filesSnapshot),
          }
        : { error: "Submission not found" };
      break;
    }
    case EvidenceArtifactKind.CODE_HISTORY: {
      filename = `code-history-${assignmentId}.json`;
      const subs =
        assignment?.workspace?.submissions.map((s) => ({
          submittedAt: s.submittedAt.toISOString(),
          isFinal: s.isFinal,
          files: JSON.parse(s.filesSnapshot) as unknown,
        })) ?? [];
      payload = { submissions: subs };
      break;
    }
    case EvidenceArtifactKind.PROCTORING_EVENTS: {
      const meta = JSON.parse(artifact.metaJson || "{}") as { sessionId?: string };
      const sessionId = meta.sessionId;
      const events = sessionId
        ? await prisma.proctoringEvent.findMany({
            where: { sessionId },
            orderBy: { createdAt: "asc" },
          })
        : [];
      filename = `proctoring-events-${assignmentId}.json`;
      payload = {
        sessionId,
        advisoryOnly: true,
        events: events.map((e) => ({
          type: e.type,
          message: e.message,
          advisory: e.advisory,
          createdAt: e.createdAt.toISOString(),
        })),
      };
      break;
    }
    case EvidenceArtifactKind.ASSESSOR_REVIEW: {
      filename = `assessor-review-${assignmentId}.json`;
      const logs = await prisma.practicalAssessorReviewLog.findMany({
        where: { assignmentId },
        orderBy: { createdAt: "asc" },
      });
      payload = {
        review: assignment?.assessorReview,
        history: logs,
      };
      break;
    }
    case EvidenceArtifactKind.MODERATION: {
      filename = `moderation-${assignmentId}.json`;
      payload = assignment?.moderationCase ?? null;
      break;
    }
    default:
      res.status(400).json({ error: "Nothing to download for this artifact type" });
      return;
  }

  const body = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
});

// Admin refresh for one assignment
evidenceRouter.post("/:assignmentId/sync", async (req, res) => {
  const synced = await syncEvidenceForAssignment(req.params.assignmentId);
  if (!synced) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true, lastSyncedAt: synced.lastSyncedAt.toISOString() });
});
