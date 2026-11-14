/**
 * Pure orchestration for incremental/resumable recording-chunk upload —
 * retry/backoff, progress tracking, and resume-after-refresh logic, written
 * against a small injected store/upload interface (same dependency-
 * injection convention this codebase already uses for AiClient, SpawnFn,
 * etc.) so it's fully unit-testable without a real IndexedDB or network.
 */

export type RecordingKind = "WEBCAM_MIC" | "SCREEN";

export interface ChunkRecord {
  sessionId: string;
  kind: RecordingKind;
  sequenceNumber: number;
  blob: Blob;
  sha256: string;
  uploaded: boolean;
  /** Whichever student was logged in when this chunk was captured — lets
   * resumePendingUploads() scope itself to "this browser's current student"
   * without ever uploading a different student's leftover chunks on a
   * shared device. Not sent to the server (the API calls below only take
   * sessionId/kind/sequenceNumber/sha256/blob) — purely a local recovery
   * boundary; the server independently re-derives and enforces real
   * ownership from the auth token on every request regardless. */
  studentId: string;
}

export interface ChunkStoreLike {
  put(record: ChunkRecord): Promise<void>;
  markUploaded(sessionId: string, kind: RecordingKind, sequenceNumber: number): Promise<void>;
  getAll(): Promise<ChunkRecord[]>;
  getForSession(sessionId: string, kind: RecordingKind): Promise<ChunkRecord[]>;
  deleteForSession(sessionId: string, kind: RecordingKind): Promise<void>;
}

export type UploadChunkFn = (
  sessionId: string,
  kind: RecordingKind,
  sequenceNumber: number,
  sha256: string,
  blob: Blob
) => Promise<unknown>;

export type CompleteFn = (
  sessionId: string,
  kind: RecordingKind,
  expectedChunkCount: number,
  mimeType: string
) => Promise<unknown>;

export type HashFn = (blob: Blob) => Promise<string>;
export type SleepFn = (ms: number) => Promise<void>;

export async function defaultHashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type CompleteSessionResult = { ok: true } | { ok: false; reason: "PENDING_UPLOADS" };

export class ChunkUploader {
  private resumeInFlight: Promise<number> | null = null;

  constructor(
    private readonly store: ChunkStoreLike,
    private readonly uploadChunk: UploadChunkFn,
    private readonly hashBlob: HashFn = defaultHashBlob,
    private readonly sleep: SleepFn = defaultSleep,
    private readonly maxRetries = 8
  ) {}

  /** Persists the chunk locally immediately (survives a crash before the
   * network call even starts), then uploads it with retry in the background. */
  async enqueueChunk(
    sessionId: string,
    kind: RecordingKind,
    sequenceNumber: number,
    blob: Blob,
    studentId: string
  ): Promise<void> {
    const sha256 = await this.hashBlob(blob);
    await this.store.put({ sessionId, kind, sequenceNumber, blob, sha256, uploaded: false, studentId });
    void this.uploadWithRetry(sessionId, kind, sequenceNumber, blob, sha256);
  }

  private async uploadWithRetry(
    sessionId: string,
    kind: RecordingKind,
    sequenceNumber: number,
    blob: Blob,
    sha256: string
  ): Promise<void> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        await this.uploadChunk(sessionId, kind, sequenceNumber, sha256, blob);
        await this.store.markUploaded(sessionId, kind, sequenceNumber);
        return;
      } catch {
        const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
        await this.sleep(delayMs);
      }
    }
  }

  /**
   * Call on app/session startup — finds every not-yet-uploaded chunk
   * belonging to `studentId` (never another student's leftovers on a
   * shared device) and retries it. `excludeSessionId` lets a caller leave
   * a currently-active recording session alone, since its own chunks are
   * already being handled in real time by enqueueChunk — this avoids a
   * second, redundant retry loop racing the live one.
   *
   * Safe to call more than once concurrently: a second call while one is
   * still running returns the same in-flight promise rather than starting
   * a competing sweep (duplicate mount effects, React StrictMode, etc.).
   */
  async resumePendingUploads(studentId: string, excludeSessionId?: string | null): Promise<number> {
    if (this.resumeInFlight) return this.resumeInFlight;
    this.resumeInFlight = this.doResume(studentId, excludeSessionId).finally(() => {
      this.resumeInFlight = null;
    });
    return this.resumeInFlight;
  }

  private async doResume(studentId: string, excludeSessionId?: string | null): Promise<number> {
    const all = await this.store.getAll();
    const pending = all.filter(
      (r) => !r.uploaded && r.studentId === studentId && r.sessionId !== excludeSessionId
    );
    await Promise.all(pending.map((r) => this.uploadWithRetry(r.sessionId, r.kind, r.sequenceNumber, r.blob, r.sha256)));
    return pending.length;
  }

  async getProgress(sessionId: string, kind: RecordingKind): Promise<{ total: number; uploaded: number }> {
    const records = await this.store.getForSession(sessionId, kind);
    return { total: records.length, uploaded: records.filter((r) => r.uploaded).length };
  }

  /** Waits (bounded by maxWaitMs) for every locally-known chunk to finish
   * uploading, then calls the completion endpoint and clears local state. */
  async completeSession(
    sessionId: string,
    kind: RecordingKind,
    completeFn: CompleteFn,
    mimeType: string,
    maxWaitMs = 30_000
  ): Promise<CompleteSessionResult> {
    const deadline = Date.now() + maxWaitMs;
    let progress = await this.getProgress(sessionId, kind);
    while (Date.now() < deadline && !(progress.total > 0 && progress.uploaded === progress.total)) {
      await this.sleep(200);
      progress = await this.getProgress(sessionId, kind);
    }
    if (progress.total === 0 || progress.uploaded !== progress.total) {
      return { ok: false, reason: "PENDING_UPLOADS" };
    }
    await completeFn(sessionId, kind, progress.total, mimeType);
    await this.store.deleteForSession(sessionId, kind);
    return { ok: true };
  }
}
