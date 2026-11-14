import { Readable } from "node:stream";
import type { StorageProvider } from "./types.js";

/**
 * Test-only in-memory StorageProvider — same role as this codebase's other
 * injectable fakes (e.g. FakeAiClient in aiClient.ts). Never used by any
 * production code path; only constructed directly in tests.
 */
export class InMemoryStorageProvider implements StorageProvider {
  private readonly files = new Map<string, Buffer>();

  async save(key: string, buffer: Buffer): Promise<void> {
    this.files.set(key, Buffer.from(buffer));
  }

  async getStream(key: string): Promise<Readable> {
    const buf = this.files.get(key);
    if (!buf) {
      throw new Error(`InMemoryStorageProvider: no such key "${key}"`);
    }
    return Readable.from(buf);
  }

  async exists(key: string): Promise<boolean> {
    return this.files.has(key);
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  /** Test helper, not part of StorageProvider — reads a saved key back directly. */
  getBuffer(key: string): Buffer | undefined {
    return this.files.get(key);
  }
}
