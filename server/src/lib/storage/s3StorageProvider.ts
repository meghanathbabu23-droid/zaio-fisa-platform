import type { Readable } from "node:stream";
import type { StorageProvider } from "./types.js";

/**
 * Deliberately not wired to a real bucket or the AWS SDK yet — see
 * docs/DEPLOYMENT-PLAN.md section 3. This exists so the StorageProvider
 * seam is real and selectable (STORAGE_PROVIDER=s3) without adding a new
 * dependency or touching any cloud account before that's explicitly
 * approved. Every method throws clearly rather than silently falling back
 * to local disk, so a misconfiguration is loud, not a quiet data-loss risk.
 */
export class S3StorageProvider implements StorageProvider {
  constructor(
    private readonly config: {
      bucket: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      endpoint?: string;
    }
  ) {}

  private notImplemented(): never {
    throw new Error(
      "S3StorageProvider is not yet implemented (no AWS SDK call wired up) — " +
        "see docs/DEPLOYMENT-PLAN.md section 3. Set STORAGE_PROVIDER=local for now."
    );
  }

  async save(_key: string, _buffer: Buffer): Promise<void> {
    this.notImplemented();
  }

  async getStream(_key: string): Promise<Readable> {
    this.notImplemented();
  }

  async exists(_key: string): Promise<boolean> {
    this.notImplemented();
  }

  async delete(_key: string): Promise<void> {
    this.notImplemented();
  }
}
