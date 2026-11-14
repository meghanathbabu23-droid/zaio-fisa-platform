import type { Readable } from "node:stream";

/**
 * Abstraction over where recording bytes (chunks and final assembled
 * artifacts) actually live. `key` is always a provider-agnostic relative
 * path, e.g. "<sessionId>/<kind>/chunk-3.bin" or "<sessionId>/<filename>" —
 * never an absolute filesystem path, so a non-local implementation (S3 or
 * similar) can use it directly as an object key.
 */
export interface StorageProvider {
  save(key: string, buffer: Buffer): Promise<void>;
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}
