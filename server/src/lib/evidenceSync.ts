import {
  AssignmentStatus,
  EvidenceArtifactKind,
  EvidenceArtifactStatus,
  type ExamType,
  ProctoringCaptureTier,
  ProctoringSessionStatus,
} from "@prisma/client";
import { access } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../prisma.js";
import { recordingPath } from "./recordingStorage.js";

const RECORDINGS_ROOT = path.join(process.cwd(), "data", "recordings");

type ArtifactInput = {
  kind: EvidenceArtifactKind;
  status: EvidenceArtifactStatus;
  sourceRecordId: string;
  label: string;
  filePath?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  capturedAt?: Date | null;
  metaJson?: Record<string, unknown>;
};

async function fileExists(fullPath: string): Promise<boolean> {
  try {
    await access(fullPath);
    return true;
  } catch {
    return false;
  }
}

function recordingAggregateStatus(
  sessions: {
    status: ProctoringSessionStatus;
    webcamStatus: string;
    screenStatus: string;
    simulatedDemo: boolean;
    recordings: { captureTier: ProctoringCaptureTier }[];
  }[]
): string {
  if (sessions.length === 0) return "none";
  const latest = sessions[0];
  const hasVerifiedReal = latest.recordings.some(
    (r) => r.captureTier === ProctoringCaptureTier.VERIFIED_REAL
  );
  if (hasVerifiedReal) return "non_empty_demo_file_on_disk";
  const hasUnverified = latest.recordings.some(
    (r) =>
      r.captureTier === ProctoringCaptureTier.DEMO_UNVERIFIED ||
      r.captureTier === ProctoringCaptureTier.INVALID_EMPTY
  );
  if (hasUnverified) return "demo_unverified_capture";
  if (latest.webcamStatus === "capturing_real" || latest.screenStatus === "capturing_real") {
    return "capturing_real";
  }
  if (latest.webcamStatus === "unavailable") return "real_capture_unavailable";
  if (latest.status === ProctoringSessionStatus.ACTIVE) return "session_active_no_file";
  return latest.status.toLowerCase();
}

function recordingArtifactStatus(
  _captureTier: ProctoringCaptureTier,
  onDisk: boolean
): EvidenceArtifactStatus {
  if (!onDisk) return EvidenceArtifactStatus.MISSING;
  // Demo index: never PRESENT for disk recordings — size tier ≠ genuine A/V evidence.
  return EvidenceArtifactStatus.SIMULATED;
}

export async function ensureEvidenceRecord(assignmentId: string) {
  const existing = await prisma.evidenceRecord.findUnique({ where: { assignmentId } });
  if (existing) return existing;
  const assignment = await prisma.examAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) return null;
  return prisma.evidenceRecord.create({
    data: {
      assignmentId,
      submissionStatus: assignment.status,
      recordingStatus: "none",
    },
  });
}

export async function syncEvidenceForAssignment(assignmentId: string) {
  const assignment = await prisma.examAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      exam: true,
      attempt: true,
      workspace: {
        include: {
          submissions: {
            orderBy: { submittedAt: "asc" },
            include: { autoAssessment: true },
          },
        },
      },
      assessorReview: true,
      moderationCase: { include: { records: { orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!assignment) return null;

  const record =
    (await ensureEvidenceRecord(assignmentId)) ??
    (await prisma.evidenceRecord.findUnique({ where: { assignmentId } }));
  if (!record) return null;

  const proctoringSessions = await prisma.proctoringSession.findMany({
    where: { assignmentId },
    orderBy: { startedAt: "desc" },
    include: { events: { orderBy: { createdAt: "asc" } }, recordings: true },
  });

  const artifacts: ArtifactInput[] = [];
  const examType: ExamType = assignment.exam.type;

  if (examType === "MCQ") {
    if (assignment.attempt?.submittedAt) {
      artifacts.push({
        kind: EvidenceArtifactKind.MCQ_ATTEMPT,
        status: EvidenceArtifactStatus.PRESENT,
        sourceRecordId: assignment.attempt.id,
        label: "MCQ attempt and answers",
        capturedAt: assignment.attempt.submittedAt,
        metaJson: {
          scorePercent: assignment.attempt.scorePercent,
          startedAt: assignment.attempt.startedAt.toISOString(),
          submittedAt: assignment.attempt.submittedAt.toISOString(),
        },
      });
    } else {
      artifacts.push({
        kind: EvidenceArtifactKind.MCQ_ATTEMPT,
        status: EvidenceArtifactStatus.MISSING,
        sourceRecordId: "mcq",
        label: "MCQ attempt and answers",
        metaJson: { reason: "No submitted attempt" },
      });
    }
  }

  if (examType === "PRACTICAL") {
    const subs = assignment.workspace?.submissions ?? [];
    if (subs.length === 0) {
      artifacts.push({
        kind: EvidenceArtifactKind.PRACTICAL_SUBMISSION,
        status: EvidenceArtifactStatus.MISSING,
        sourceRecordId: "final",
        label: "Practical submission",
        metaJson: { reason: "No submissions recorded" },
      });
    } else {
      for (const sub of subs) {
        artifacts.push({
          kind: EvidenceArtifactKind.PRACTICAL_SUBMISSION,
          status: EvidenceArtifactStatus.PRESENT,
          sourceRecordId: sub.id,
          label: sub.isFinal ? "Final practical submission" : "Practical autosave submission",
          capturedAt: sub.submittedAt,
          metaJson: {
            isFinal: sub.isFinal,
            autoScorePercent: sub.autoAssessment?.scorePercent ?? null,
          },
        });
      }
    }

    const historyCount = subs.length;
    artifacts.push({
      kind: EvidenceArtifactKind.CODE_HISTORY,
      status: historyCount > 0 ? EvidenceArtifactStatus.PRESENT : EvidenceArtifactStatus.MISSING,
      sourceRecordId: assignment.workspace?.id ?? "workspace",
      label: "Code submission history",
      capturedAt: assignment.workspace?.lastSavedAt ?? null,
      metaJson: {
        submissionCount: historyCount,
        workspaceId: assignment.workspace?.id ?? null,
        lockedAt: assignment.workspace?.lockedAt?.toISOString() ?? null,
      },
    });
  }

  for (const session of proctoringSessions) {
    const eventsKey = `events-${session.id}`;
    const hasEvents = session.events.length > 0;
    artifacts.push({
      kind: EvidenceArtifactKind.PROCTORING_EVENTS,
      status: !hasEvents
        ? EvidenceArtifactStatus.MISSING
        : session.simulatedDemo
          ? EvidenceArtifactStatus.SIMULATED
          : EvidenceArtifactStatus.PRESENT,
      sourceRecordId: eventsKey,
      label: `Proctoring events (${session.status})`,
      capturedAt: session.events[session.events.length - 1]?.createdAt ?? session.startedAt,
      metaJson: {
        sessionId: session.id,
        eventCount: session.events.length,
        simulatedDemo: session.simulatedDemo,
        advisoryOnly: true,
      },
    });

    if (session.recordings.length === 0) {
      artifacts.push({
        kind: EvidenceArtifactKind.PROCTORING_RECORDING,
        status: EvidenceArtifactStatus.MISSING,
        sourceRecordId: `none-${session.id}`,
        label: "Proctoring recordings",
        metaJson: { sessionId: session.id, reason: "No uploads" },
      });
    } else {
      for (const rec of session.recordings) {
        const full = recordingPath(session.id, rec.filename);
        const rel = path.relative(process.cwd(), full);
        const onDisk = await fileExists(full);
        const tier = rec.captureTier;
        artifacts.push({
          kind: EvidenceArtifactKind.PROCTORING_RECORDING,
          status: recordingArtifactStatus(tier, onDisk),
          sourceRecordId: rec.id,
          label:
            tier === ProctoringCaptureTier.VERIFIED_REAL
              ? `${rec.kind} — non-empty demo file (${rec.filename})`
              : `${rec.kind} — placeholder/unverified (${rec.filename})`,
          filePath: onDisk ? rel : null,
          mimeType: rec.mimeType,
          sizeBytes: rec.sizeBytes,
          capturedAt: rec.storedAt,
          metaJson: {
            sessionId: session.id,
            captureTier: tier,
            verifiedNonEmpty: tier === ProctoringCaptureTier.VERIFIED_REAL,
            ...(tier === ProctoringCaptureTier.VERIFIED_REAL
              ? {
                  sizeOnlyVerification:
                    "1024+ bytes on disk; not validated as playable A/V.",
                }
              : {}),
            simulatedDemo: session.simulatedDemo,
            note:
              "Proctoring files are always simulated in this evidence index — never certified media.",
          },
        });
      }
    }
  }

  if (examType === "PRACTICAL") {
    if (assignment.assessorReview) {
      const logs = await prisma.practicalAssessorReviewLog.count({
        where: { assignmentId },
      });
      artifacts.push({
        kind: EvidenceArtifactKind.ASSESSOR_REVIEW,
        status: EvidenceArtifactStatus.PRESENT,
        sourceRecordId: assignment.assessorReview.id,
        label: "Assessor review",
        capturedAt: assignment.assessorReview.updatedAt,
        metaJson: {
          automatedScorePercent: assignment.assessorReview.automatedScorePercent,
          finalScorePercent: assignment.assessorReview.finalScorePercent,
          logCount: logs,
        },
      });
    } else if (assignment.status === AssignmentStatus.SUBMITTED) {
      artifacts.push({
        kind: EvidenceArtifactKind.ASSESSOR_REVIEW,
        status: EvidenceArtifactStatus.MISSING,
        sourceRecordId: "review",
        label: "Assessor review",
        metaJson: { reason: "Submitted but no assessor review record" },
      });
    }
  }

  if (assignment.moderationCase) {
    artifacts.push({
      kind: EvidenceArtifactKind.MODERATION,
      status: EvidenceArtifactStatus.PRESENT,
      sourceRecordId: assignment.moderationCase.id,
      label: "Moderation case",
      capturedAt: assignment.moderationCase.updatedAt,
      metaJson: {
        status: assignment.moderationCase.status,
        recordCount: assignment.moderationCase.records.length,
        advisoryFlags: JSON.parse(assignment.moderationCase.advisoryFlagsJson || "[]"),
      },
    });
  } else if (examType === "PRACTICAL" && assignment.status === AssignmentStatus.SUBMITTED) {
    artifacts.push({
      kind: EvidenceArtifactKind.MODERATION,
      status: EvidenceArtifactStatus.MISSING,
      sourceRecordId: "moderation",
      label: "Moderation case",
      metaJson: { reason: "No moderation case linked" },
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.evidenceArtifact.deleteMany({ where: { evidenceId: record.id } });
    if (artifacts.length > 0) {
      await tx.evidenceArtifact.createMany({
        data: artifacts.map((a) => ({
          evidenceId: record.id,
          kind: a.kind,
          status: a.status,
          sourceRecordId: a.sourceRecordId,
          label: a.label,
          filePath: a.filePath ?? null,
          mimeType: a.mimeType ?? null,
          sizeBytes: a.sizeBytes ?? null,
          capturedAt: a.capturedAt ?? null,
          metaJson: JSON.stringify(a.metaJson ?? {}),
        })),
      });
    }
    await tx.evidenceRecord.update({
      where: { id: record.id },
      data: {
        submissionStatus: assignment.status,
        recordingStatus: recordingAggregateStatus(
          proctoringSessions.map((s) => ({ ...s, recordings: s.recordings }))
        ),
        lastSyncedAt: new Date(),
      },
    });
  });

  return prisma.evidenceRecord.findUnique({
    where: { id: record.id },
    include: { artifacts: { orderBy: { createdAt: "asc" } } },
  });
}

export async function backfillEvidenceRecords() {
  const assignments = await prisma.examAssignment.findMany({ select: { id: true } });
  let synced = 0;
  for (const a of assignments) {
    await ensureEvidenceRecord(a.id);
    await syncEvidenceForAssignment(a.id);
    synced += 1;
  }
  return synced;
}

export function resolveSafeRecordingPath(relOrAbs: string): string | null {
  const resolved = path.isAbsolute(relOrAbs)
    ? path.normalize(relOrAbs)
    : path.normalize(path.join(process.cwd(), relOrAbs));
  const root = path.normalize(RECORDINGS_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}
