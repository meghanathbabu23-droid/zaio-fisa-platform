import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbChunkStore } from "./chunkStore";
import type { ChunkRecord } from "./chunkUploader";

/**
 * jsdom (this project's test environment) doesn't implement IndexedDB at
 * all, so these tests run against fake-indexeddb — a pure-JS in-memory
 * implementation of the real browser API, not a hand-rolled mock. A fresh
 * IDBFactory before every test gives each test its own isolated "browser
 * storage", matching a real browser's per-origin isolation and making
 * "reopening" tests meaningful (reusing the SAME factory instance across
 * two IndexedDbChunkStore instances is what simulates a page reload).
 */
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

function makeRecord(overrides: Partial<ChunkRecord> = {}): ChunkRecord {
  return {
    sessionId: "s1",
    kind: "WEBCAM_MIC",
    sequenceNumber: 0,
    blob: new Blob(["x"]),
    sha256: "abc",
    uploaded: false,
    studentId: "student-a",
    ...overrides,
  };
}

describe("IndexedDbChunkStore — database creation and reopening", () => {
  it("creates the database and object store on first use", async () => {
    const store = new IndexedDbChunkStore();
    await store.put(makeRecord());
    const records = await store.getForSession("s1", "WEBCAM_MIC");
    expect(records).toHaveLength(1);
  });

  it("a second store instance against the same underlying IndexedDB sees data written by the first (simulated page reload)", async () => {
    const first = new IndexedDbChunkStore();
    await first.put(makeRecord({ sequenceNumber: 0 }));
    await first.put(makeRecord({ sequenceNumber: 1 }));

    // A brand-new instance, same global indexedDB — exactly what happens
    // across a page refresh in a real browser (IndexedDB persists, a fresh
    // JS heap does not).
    const reopened = new IndexedDbChunkStore();
    const records = await reopened.getForSession("s1", "WEBCAM_MIC");
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.sequenceNumber).sort()).toEqual([0, 1]);
  });
});

describe("IndexedDbChunkStore — saving and retrieving", () => {
  it("saves a chunk with all its fields intact", async () => {
    const store = new IndexedDbChunkStore();
    await store.put(makeRecord({ sha256: "deadbeef", studentId: "student-x" }));
    const [record] = await store.getForSession("s1", "WEBCAM_MIC");
    expect(record.sha256).toBe("deadbeef");
    expect(record.studentId).toBe("student-x");
    expect(record.uploaded).toBe(false);
  });

  it("getAll returns chunks across every session/kind, with their uploaded flags intact, so a caller can filter to pending ones", async () => {
    const store = new IndexedDbChunkStore();
    await store.put(makeRecord({ sessionId: "s1", sequenceNumber: 0, uploaded: false }));
    await store.put(makeRecord({ sessionId: "s1", sequenceNumber: 1, uploaded: true }));
    await store.put(makeRecord({ sessionId: "s2", kind: "SCREEN", sequenceNumber: 0, uploaded: false }));

    const all = await store.getAll();
    expect(all).toHaveLength(3);
    const pending = all.filter((r) => !r.uploaded);
    expect(pending).toHaveLength(2);
  });

  it("getForSession only returns records for that exact sessionId + kind pair", async () => {
    const store = new IndexedDbChunkStore();
    await store.put(makeRecord({ sessionId: "s1", kind: "WEBCAM_MIC" }));
    await store.put(makeRecord({ sessionId: "s1", kind: "SCREEN" }));
    await store.put(makeRecord({ sessionId: "s2", kind: "WEBCAM_MIC" }));

    expect(await store.getForSession("s1", "WEBCAM_MIC")).toHaveLength(1);
    expect(await store.getForSession("s1", "SCREEN")).toHaveLength(1);
    expect(await store.getForSession("s2", "WEBCAM_MIC")).toHaveLength(1);
  });
});

describe("IndexedDbChunkStore — acknowledgement state", () => {
  it("markUploaded flips uploaded to true without touching other fields", async () => {
    const store = new IndexedDbChunkStore();
    await store.put(makeRecord({ sha256: "keepme", sequenceNumber: 3 }));

    await store.markUploaded("s1", "WEBCAM_MIC", 3);

    const [record] = await store.getForSession("s1", "WEBCAM_MIC");
    expect(record.uploaded).toBe(true);
    expect(record.sha256).toBe("keepme");
    expect(record.sequenceNumber).toBe(3);
  });

  it("markUploaded on a key that was never saved is a safe no-op", async () => {
    const store = new IndexedDbChunkStore();
    await expect(store.markUploaded("never-seen", "WEBCAM_MIC", 0)).resolves.toBeUndefined();
  });
});

describe("IndexedDbChunkStore — deletion", () => {
  it("deleteForSession removes only that session+kind's chunks, leaving everything else untouched", async () => {
    const store = new IndexedDbChunkStore();
    await store.put(makeRecord({ sessionId: "s1", kind: "WEBCAM_MIC", sequenceNumber: 0 }));
    await store.put(makeRecord({ sessionId: "s1", kind: "WEBCAM_MIC", sequenceNumber: 1 }));
    await store.put(makeRecord({ sessionId: "s1", kind: "SCREEN", sequenceNumber: 0 }));
    await store.put(makeRecord({ sessionId: "s2", kind: "WEBCAM_MIC", sequenceNumber: 0 }));

    await store.deleteForSession("s1", "WEBCAM_MIC");

    expect(await store.getForSession("s1", "WEBCAM_MIC")).toHaveLength(0);
    expect(await store.getForSession("s1", "SCREEN")).toHaveLength(1); // different kind, untouched
    expect(await store.getForSession("s2", "WEBCAM_MIC")).toHaveLength(1); // different session, untouched
  });
});

describe("IndexedDbChunkStore — duplicate keys", () => {
  it("re-putting the same sessionId+kind+sequenceNumber overwrites rather than duplicating", async () => {
    const store = new IndexedDbChunkStore();
    await store.put(makeRecord({ sequenceNumber: 0, sha256: "first-write" }));
    await store.put(makeRecord({ sequenceNumber: 0, sha256: "second-write-same-key" }));

    const records = await store.getForSession("s1", "WEBCAM_MIC");
    expect(records).toHaveLength(1);
    expect(records[0].sha256).toBe("second-write-same-key");
  });

  it("distinct sequence numbers for the same session+kind never collide", async () => {
    const store = new IndexedDbChunkStore();
    await store.put(makeRecord({ sequenceNumber: 0 }));
    await store.put(makeRecord({ sequenceNumber: 1 }));
    await store.put(makeRecord({ sequenceNumber: 2 }));

    expect(await store.getForSession("s1", "WEBCAM_MIC")).toHaveLength(3);
  });
});

describe("IndexedDbChunkStore — error handling", () => {
  it("surfaces an indexedDB.open() failure as a rejected promise rather than hanging", async () => {
    const simulatedError = new Error("simulated IndexedDB open failure");
    // A minimal stand-in for the one IDBFactory method chunkStore.ts
    // actually calls — deliberately not fake-indexeddb here, since the
    // point is to force the specific failure path a real browser can hit
    // (e.g. storage quota exceeded, blocked by a browser privacy setting),
    // which fake-indexeddb has no built-in way to simulate on demand.
    const failingFactory = {
      open: () => {
        const request: {
          onerror: (() => void) | null;
          onsuccess: (() => void) | null;
          onupgradeneeded: (() => void) | null;
          error: Error;
        } = { onerror: null, onsuccess: null, onupgradeneeded: null, error: simulatedError };
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    };
    globalThis.indexedDB = failingFactory as unknown as IDBFactory;

    const store = new IndexedDbChunkStore();
    await expect(store.put(makeRecord())).rejects.toThrow("simulated IndexedDB open failure");
  });
});
