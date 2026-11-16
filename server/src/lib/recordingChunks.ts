import { createHash } from "node:crypto";
import { ProctoringCaptureTier, type ProctoringRecordingKind } from "@prisma/client";
import { prisma } from "../prisma.js";
import { getStorageProvider } from "./storage/index.js";
import { classifyRecordingBuffer } from "./recordingVerify.js";
import { saveRecordingFile } from "./recordingStorage.js";
import { withPrismaWriteConflictRetry } from "./prismaWriteConflict.js";

/** Generous for a ~4s MediaRecorder timeslice chunk — far smaller than the
 * old single-shot endpoint's 20MB whole-recording cap. */
export const MAX_CHUNK_BYTES = 5 * 1024 * 1024;
/** Sanity cap, not a real exam duration — guards against a malformed/abusive sequence number. */
export const MAX_SEQUENCE_NUMBER = 100_000;

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function chunkStorageKey(
  sessionId: string,
  kind: ProctoringRecordingKind,
  sequenceNumber: number
): string {
  return `${sessionId}/${kind.toLowerCase()}/chunk-${sequenceNumber}.bin`;
}

export type ChunkValidationError =
  | "INVALID_SEQUENCE"
  | "CHUNK_TOO_LARGE"
  | "CHECKSUM_MISMATCH"
  | "CHUNK_CONFLICT";

export type ReceiveChunkResult =
  | { ok: true; alreadyReceived: boolean }
  | { ok: false; error: ChunkValidationError };

/** Idempotent: re-sending the same (sessionId, kind, sequenceNumber) with the
 * same bytes is a no-op success, not a duplicate write — this is what makes
 * client-side retries safe. A different payload for the same sequence
 * number is a genuine conflict, surfaced rather than silently overwritten. */
export async function receiveChunk(params: {
  sessionId: string;
  kind: ProctoringRecordingKind;
  sequenceNumber: number;
  claimedSha256: string;
  buffer: Buffer;
}): Promise<ReceiveChunkResult> {
  const { sessionId, kind, sequenceNumber, claimedSha256, buffer } = params;

  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 0 || sequenceNumber > MAX_SEQUENCE_NUMBER) {
    return { ok: false, error: "INVALID_SEQUENCE" };
  }
  if (buffer.length > MAX_CHUNK_BYTES) {
    return { ok: false, error: "CHUNK_TOO_LARGE" };
  }
  const actualSha256 = sha256Hex(buffer);
  if (actualSha256 !== claimedSha256) {
    return { ok: false, error: "CHECKSUM_MISMATCH" };
  }

  const existing = await prisma.proctoringRecordingChunk.findUnique({
    where: { sessionId_kind_sequenceNumber: { sessionId, kind, sequenceNumber } },
  });
  if (existing) {
    return existing.sha256 === actualSha256
      ? { ok: true, alreadyReceived: true }
      : { ok: false, error: "CHUNK_CONFLICT" };
  }

  const storageKey = chunkStorageKey(sessionId, kind, sequenceNumber);
  await getStorageProvider().save(storageKey, buffer);

  const write = await withPrismaWriteConflictRetry(async (): Promise<ReceiveChunkResult> => {
    const raced = await prisma.proctoringRecordingChunk.findUnique({
      where: { sessionId_kind_sequenceNumber: { sessionId, kind, sequenceNumber } },
    });
    if (raced) {
      return raced.sha256 === actualSha256
        ? { ok: true, alreadyReceived: true }
        : { ok: false, error: "CHUNK_CONFLICT" };
    }
    await prisma.proctoringRecordingChunk.create({
      data: { sessionId, kind, sequenceNumber, sha256: actualSha256, sizeBytes: buffer.length, storageKey },
    });
    return { ok: true, alreadyReceived: false };
  });

  return write;
}

export type CompleteError = "MISSING_CHUNKS" | "FINAL_CHECKSUM_MISMATCH" | "EMPTY";

export type CompleteResult =
  | { ok: true; recordingId: string; filename: string; sizeBytes: number; captureTier: ProctoringCaptureTier }
  | { ok: false; error: CompleteError; missingSequenceNumbers?: number[] };

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) {
    parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

/** Verifies every expected sequence number is present, concatenates in
 * order (the same simple-concatenation approach the old finalizeRecordings()
 * path already relies on for WebM), persists the result via the existing
 * saveRecordingFile()/ProctoringRecording path so the final artifact is
 * indistinguishable from one produced by the old single-shot endpoint —
 * evidence.ts's download route needs no changes. */
export async function completeRecording(params: {
  sessionId: string;
  kind: ProctoringRecordingKind;
  expectedChunkCount: number;
  finalSha256?: string;
  mimeType: string;
}): Promise<CompleteResult> {
  const { sessionId, kind, expectedChunkCount, finalSha256, mimeType } = params;

  // Idempotency: a client that retries /complete after a response it never
  // saw (timeout, dropped connection) must not get a confusing
  // MISSING_CHUNKS error on a request that actually already succeeded —
  // and must never create a second ProctoringRecording for the same
  // session+kind. Chunks are deleted only after this row is created (see
  // below), so its existence is the single source of truth for "already done".
  const existing = await prisma.proctoringRecording.findFirst({
    where: { sessionId, kind },
    orderBy: { storedAt: "desc" },
  });
  if (existing) {
    return {
      ok: true,
      recordingId: existing.id,
      filename: existing.filename,
      sizeBytes: existing.sizeBytes,
      captureTier: existing.captureTier,
    };
  }

  if (expectedChunkCount < 1) {
    return { ok: false, error: "EMPTY" };
  }

  const chunks = await prisma.proctoringRecordingChunk.findMany({
    where: { sessionId, kind },
  });
  const bySeq = new Map(chunks.map((c) => [c.sequenceNumber, c]));
  const missing: number[] = [];
  for (let i = 0; i < expectedChunkCount; i++) {
    if (!bySeq.has(i)) missing.push(i);
  }
  if (missing.length > 0) {
    return { ok: false, error: "MISSING_CHUNKS", missingSequenceNumbers: missing };
  }

  const provider = getStorageProvider();
  const buffers: Buffer[] = [];
  for (let i = 0; i < expectedChunkCount; i++) {
    const stream = await provider.getStream(bySeq.get(i)!.storageKey);
    buffers.push(await streamToBuffer(stream));
  }
  const combined = Buffer.concat(buffers);

  if (finalSha256 && sha256Hex(combined) !== finalSha256) {
    return { ok: false, error: "FINAL_CHECKSUM_MISMATCH" };
  }

  const captureTier = classifyRecordingBuffer(combined);
  if (captureTier === ProctoringCaptureTier.INVALID_EMPTY) {
    return { ok: false, error: "EMPTY" };
  }

  const ext = mimeType.includes("webm") ? "webm" : "bin";
  const filename = `${kind.toLowerCase()}-${Date.now()}.${ext}`;
  await saveRecordingFile(sessionId, filename, combined);

  const record = await prisma.proctoringRecording.create({
    data: { sessionId, kind, filename, mimeType, sizeBytes: combined.length, captureTier },
  });

  for (const chunk of chunks) {
    await provider.delete(chunk.storageKey).catch(() => {});
  }
  await prisma.proctoringRecordingChunk.deleteMany({ where: { sessionId, kind } });

  return {
    ok: true,
    recordingId: record.id,
    filename,
    sizeBytes: record.sizeBytes,
    captureTier: record.captureTier,
  };
}

export type RecordingUploadStatus = "complete" | "incomplete" | "not_started";

/**
 * Lets an admin tell "a recording was attempted but never finished" apart
 * from "nothing was ever attempted" — before this, both looked identical
 * (no ProctoringRecording row either way). Pure function over already-
 * fetched rows, so the admin routes can batch this via a single Prisma
 * `include` rather than an extra query per session.
 */
export function computeRecordingUploadStatus(
  recordings: { kind: ProctoringRecordingKind }[],
  chunks: { kind: ProctoringRecordingKind }[]
): Record<ProctoringRecordingKind, RecordingUploadStatus> {
  const kinds: ProctoringRecordingKind[] = ["WEBCAM_MIC", "SCREEN"];
  const result = {} as Record<ProctoringRecordingKind, RecordingUploadStatus>;
  for (const kind of kinds) {
    if (recordings.some((r) => r.kind === kind)) {
      result[kind] = "complete";
    } else if (chunks.some((c) => c.kind === kind)) {
      result[kind] = "incomplete";
    } else {
      result[kind] = "not_started";
    }
  }
  return result;
}

/** For the client-recovery status endpoint — which sequence numbers the
 * server already has, so a resumed session doesn't re-upload them. */
export async function receivedSequenceNumbers(
  sessionId: string,
  kind: ProctoringRecordingKind
): Promise<number[]> {
  const chunks = await prisma.proctoringRecordingChunk.findMany({
    where: { sessionId, kind },
    select: { sequenceNumber: true },
    orderBy: { sequenceNumber: "asc" },
  });
  return chunks.map((c) => c.sequenceNumber);
}
