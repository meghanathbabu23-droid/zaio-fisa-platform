import type { ChunkRecord, ChunkStoreLike, RecordingKind } from "./chunkUploader";

const DB_NAME = "fisa-proctoring-chunks";
const STORE_NAME = "chunks";
const DB_VERSION = 1;

function keyFor(sessionId: string, kind: RecordingKind, sequenceNumber: number): string {
  return `${sessionId}:${kind}:${sequenceNumber}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Real IndexedDB-backed ChunkStoreLike — this is what survives a tab crash
 * or browser restart. The orchestration logic in chunkUploader.ts never
 * talks to IndexedDB directly, only through this interface, so it stays
 * unit-testable with a plain in-memory fake.
 */
export class IndexedDbChunkStore implements ChunkStoreLike {
  private readonly dbPromise = openDb();

  async put(record: ChunkRecord): Promise<void> {
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({
        key: keyFor(record.sessionId, record.kind, record.sequenceNumber),
        ...record,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async markUploaded(sessionId: string, kind: RecordingKind, sequenceNumber: number): Promise<void> {
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const key = keyFor(sessionId, kind, sequenceNumber);
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const existing = getReq.result as (ChunkRecord & { key: string }) | undefined;
        if (existing) {
          existing.uploaded = true;
          store.put(existing);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAll(): Promise<ChunkRecord[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as ChunkRecord[]);
      req.onerror = () => reject(req.error);
    });
  }

  async getForSession(sessionId: string, kind: RecordingKind): Promise<ChunkRecord[]> {
    const all = await this.getAll();
    return all.filter((r) => r.sessionId === sessionId && r.kind === kind);
  }

  async deleteForSession(sessionId: string, kind: RecordingKind): Promise<void> {
    const db = await this.dbPromise;
    const records = await this.getForSession(sessionId, kind);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const r of records) store.delete(keyFor(r.sessionId, r.kind, r.sequenceNumber));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
