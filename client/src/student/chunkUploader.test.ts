import { describe, it, expect, vi } from "vitest";
import { ChunkUploader, type ChunkRecord, type ChunkStoreLike, type RecordingKind } from "./chunkUploader";

class FakeChunkStore implements ChunkStoreLike {
  records = new Map<string, ChunkRecord>();

  private key(sessionId: string, kind: RecordingKind, sequenceNumber: number): string {
    return `${sessionId}:${kind}:${sequenceNumber}`;
  }

  async put(record: ChunkRecord): Promise<void> {
    this.records.set(this.key(record.sessionId, record.kind, record.sequenceNumber), { ...record });
  }

  async markUploaded(sessionId: string, kind: RecordingKind, sequenceNumber: number): Promise<void> {
    const r = this.records.get(this.key(sessionId, kind, sequenceNumber));
    if (r) r.uploaded = true;
  }

  async getAll(): Promise<ChunkRecord[]> {
    return [...this.records.values()];
  }

  async getForSession(sessionId: string, kind: RecordingKind): Promise<ChunkRecord[]> {
    return [...this.records.values()].filter((r) => r.sessionId === sessionId && r.kind === kind);
  }

  async deleteForSession(sessionId: string, kind: RecordingKind): Promise<void> {
    for (const [key, r] of this.records) {
      if (r.sessionId === sessionId && r.kind === kind) this.records.delete(key);
    }
  }
}

const instantSleep = async () => {};
const fakeBlob = () => new Blob(["x"]);
const fakeHash = async () => "deadbeef";
const STUDENT_A = "student-a";
const STUDENT_B = "student-b";

function seed(store: FakeChunkStore, overrides: Partial<ChunkRecord>): Promise<void> {
  return store.put({
    sessionId: "s1",
    kind: "WEBCAM_MIC",
    sequenceNumber: 0,
    blob: fakeBlob(),
    sha256: "a",
    uploaded: false,
    studentId: STUDENT_A,
    ...overrides,
  });
}

describe("ChunkUploader — persistence", () => {
  it("persists a chunk to the store immediately, before the upload resolves", async () => {
    let resolveUpload: () => void = () => {};
    const uploadFn = vi.fn(() => new Promise<void>((resolve) => (resolveUpload = resolve)));
    const store = new FakeChunkStore();
    const uploader = new ChunkUploader(store, uploadFn, fakeHash, instantSleep);

    await uploader.enqueueChunk("s1", "WEBCAM_MIC", 0, fakeBlob(), STUDENT_A);

    const stored = await store.getForSession("s1", "WEBCAM_MIC");
    expect(stored).toHaveLength(1);
    expect(stored[0].uploaded).toBe(false); // upload hasn't resolved yet
    expect(stored[0].studentId).toBe(STUDENT_A);
    resolveUpload();
  });

  it("uses the injected hash function's result as the chunk's sha256", async () => {
    const uploadFn = vi.fn().mockResolvedValue(undefined);
    const store = new FakeChunkStore();
    const uploader = new ChunkUploader(store, uploadFn, fakeHash, instantSleep);

    await uploader.enqueueChunk("s1", "SCREEN", 0, fakeBlob(), STUDENT_A);
    const [record] = await store.getForSession("s1", "SCREEN");
    expect(record.sha256).toBe("deadbeef");
  });
});

describe("ChunkUploader — retry with backoff (interrupted uploads)", () => {
  it("retries a failing upload and eventually marks it uploaded once it succeeds", async () => {
    let attempts = 0;
    const uploadFn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("network blip");
    });
    const store = new FakeChunkStore();
    await seed(store, {});
    const uploader = new ChunkUploader(store, uploadFn, fakeHash, instantSleep);

    const resumed = await uploader.resumePendingUploads(STUDENT_A);

    expect(resumed).toBe(1);
    expect(attempts).toBe(3);
    const [record] = await store.getForSession("s1", "WEBCAM_MIC");
    expect(record.uploaded).toBe(true);
  });

  it("gives up after maxRetries, leaving the chunk unmarked rather than losing it", async () => {
    const uploadFn = vi.fn(async () => {
      throw new Error("always fails");
    });
    const store = new FakeChunkStore();
    await seed(store, {});
    const uploader = new ChunkUploader(store, uploadFn, fakeHash, instantSleep, 3);

    await uploader.resumePendingUploads(STUDENT_A);

    expect(uploadFn).toHaveBeenCalledTimes(3);
    const [record] = await store.getForSession("s1", "WEBCAM_MIC");
    expect(record.uploaded).toBe(false); // still recoverable on the next resume, not lost
  });
});

describe("ChunkUploader — browser recovery (resumePendingUploads)", () => {
  it("only retries chunks not already marked uploaded, regardless of their original order", async () => {
    const uploadFn = vi.fn().mockResolvedValue(undefined);
    const store = new FakeChunkStore();
    // Seeded out of sequence order on purpose — resume must not care about order.
    await seed(store, { sequenceNumber: 2, sha256: "a" });
    await seed(store, { sequenceNumber: 0, sha256: "b", uploaded: true });
    await seed(store, { sequenceNumber: 1, sha256: "c" });
    const uploader = new ChunkUploader(store, uploadFn, fakeHash, instantSleep);

    const resumedCount = await uploader.resumePendingUploads(STUDENT_A);

    expect(resumedCount).toBe(2); // only the two unuploaded ones
    expect(uploadFn).toHaveBeenCalledTimes(2);
    const all = await store.getForSession("s1", "WEBCAM_MIC");
    expect(all.every((r) => r.uploaded)).toBe(true);
  });

  it("simulates a tab crash mid-session: chunks persisted but never uploaded are picked up by a fresh uploader instance on reload", async () => {
    const store = new FakeChunkStore();
    await seed(store, { kind: "SCREEN", sequenceNumber: 0, sha256: "a" });
    await seed(store, { kind: "SCREEN", sequenceNumber: 1, sha256: "b" });

    // A brand-new ChunkUploader instance, as would happen after a page reload — same store, fresh object.
    const uploadFn = vi.fn().mockResolvedValue(undefined);
    const freshUploader = new ChunkUploader(store, uploadFn, fakeHash, instantSleep);
    const resumedCount = await freshUploader.resumePendingUploads(STUDENT_A);

    expect(resumedCount).toBe(2);
    expect((await store.getForSession("s1", "SCREEN")).every((r) => r.uploaded)).toBe(true);
  });

  it("never resumes another student's leftover chunks on a shared device", async () => {
    const uploadFn = vi.fn().mockResolvedValue(undefined);
    const store = new FakeChunkStore();
    await seed(store, { sequenceNumber: 0, studentId: STUDENT_A });
    await seed(store, { sessionId: "s2", sequenceNumber: 0, studentId: STUDENT_B });
    const uploader = new ChunkUploader(store, uploadFn, fakeHash, instantSleep);

    const resumedForA = await uploader.resumePendingUploads(STUDENT_A);

    expect(resumedForA).toBe(1);
    expect(uploadFn).toHaveBeenCalledTimes(1);
    const bChunk = (await store.getForSession("s2", "WEBCAM_MIC"))[0];
    expect(bChunk.uploaded).toBe(false); // untouched — belongs to a different student
  });

  it("excludes the currently-active session from the sweep, leaving it to the live upload path", async () => {
    const uploadFn = vi.fn().mockResolvedValue(undefined);
    const store = new FakeChunkStore();
    await seed(store, { sessionId: "active-session", sequenceNumber: 0 });
    await seed(store, { sessionId: "other-session", sequenceNumber: 0 });
    const uploader = new ChunkUploader(store, uploadFn, fakeHash, instantSleep);

    const resumedCount = await uploader.resumePendingUploads(STUDENT_A, "active-session");

    expect(resumedCount).toBe(1);
    expect(uploadFn).toHaveBeenCalledTimes(1);
    const activeChunk = (await store.getForSession("active-session", "WEBCAM_MIC"))[0];
    expect(activeChunk.uploaded).toBe(false); // left alone, as intended
    const otherChunk = (await store.getForSession("other-session", "WEBCAM_MIC"))[0];
    expect(otherChunk.uploaded).toBe(true);
  });

  it("a second concurrent call returns the same in-flight sweep instead of starting a competing one", async () => {
    const uploadFn = vi.fn().mockResolvedValue(undefined);
    const store = new FakeChunkStore();
    await seed(store, { sequenceNumber: 0 });
    const uploader = new ChunkUploader(store, uploadFn, fakeHash, instantSleep);

    // Both fired back-to-back, synchronously — before either has had a
    // chance to resolve. The second must join the first's in-flight sweep,
    // not start a second one.
    const first = uploader.resumePendingUploads(STUDENT_A);
    const second = uploader.resumePendingUploads(STUDENT_A);
    const [firstCount, secondCount] = await Promise.all([first, second]);

    expect(firstCount).toBe(1);
    expect(secondCount).toBe(1);
    // Only one actual upload attempt was made despite two resume calls.
    expect(uploadFn).toHaveBeenCalledTimes(1);
  });
});

describe("ChunkUploader — completeSession (missing chunks)", () => {
  it("refuses to complete while any chunk is still unuploaded", async () => {
    const store = new FakeChunkStore();
    await seed(store, { sequenceNumber: 0, uploaded: true });
    await seed(store, { sequenceNumber: 1, uploaded: false });
    const uploader = new ChunkUploader(store, vi.fn(), fakeHash, instantSleep);
    const completeFn = vi.fn();

    const result = await uploader.completeSession("s1", "WEBCAM_MIC", completeFn, "video/webm", 50);

    expect(result).toEqual({ ok: false, reason: "PENDING_UPLOADS" });
    expect(completeFn).not.toHaveBeenCalled();
  });

  it("completes and clears local state once every chunk is uploaded", async () => {
    const store = new FakeChunkStore();
    await seed(store, { sequenceNumber: 0, uploaded: true });
    await seed(store, { sequenceNumber: 1, uploaded: true });
    const uploader = new ChunkUploader(store, vi.fn(), fakeHash, instantSleep);
    const completeFn = vi.fn().mockResolvedValue(undefined);

    const result = await uploader.completeSession("s1", "WEBCAM_MIC", completeFn, "video/webm");

    expect(result).toEqual({ ok: true });
    expect(completeFn).toHaveBeenCalledWith("s1", "WEBCAM_MIC", 2, "video/webm");
    expect(await store.getForSession("s1", "WEBCAM_MIC")).toHaveLength(0);
  });

  it("returns PENDING_UPLOADS (not an error) when no chunks exist at all for the session", async () => {
    const store = new FakeChunkStore();
    const uploader = new ChunkUploader(store, vi.fn(), fakeHash, instantSleep);
    const result = await uploader.completeSession("s1", "WEBCAM_MIC", vi.fn(), "video/webm", 10);
    expect(result).toEqual({ ok: false, reason: "PENDING_UPLOADS" });
  });
});
