import { createReadStream } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { StorageProvider } from "./types.js";

/**
 * Today's exact on-disk behavior (previously inlined in recordingStorage.ts),
 * now behind the StorageProvider interface. This is the default provider —
 * local development and any environment without STORAGE_PROVIDER=s3 set
 * keeps working exactly as before, byte for byte.
 */
export class LocalDiskStorageProvider implements StorageProvider {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    return path.join(this.root, key);
  }

  async save(key: string, buffer: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, buffer);
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
