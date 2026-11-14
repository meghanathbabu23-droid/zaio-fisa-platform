import path from "node:path";
import { LocalDiskStorageProvider } from "./localDiskStorageProvider.js";
import { S3StorageProvider } from "./s3StorageProvider.js";
import type { StorageProvider } from "./types.js";

export type { StorageProvider } from "./types.js";

const RECORDINGS_ROOT = path.join(process.cwd(), "data", "recordings");

let overrideForTests: StorageProvider | null = null;
let cached: StorageProvider | null = null;

function buildProvider(): StorageProvider {
  const mode = process.env.STORAGE_PROVIDER ?? "local";
  if (mode === "s3") {
    return new S3StorageProvider({
      bucket: process.env.S3_BUCKET ?? "",
      region: process.env.S3_REGION ?? "",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      endpoint: process.env.S3_ENDPOINT || undefined,
    });
  }
  return new LocalDiskStorageProvider(RECORDINGS_ROOT);
}

export function getStorageProvider(): StorageProvider {
  if (overrideForTests) return overrideForTests;
  if (!cached) cached = buildProvider();
  return cached;
}

/** Mirrors setAiClientOverrideForTests' hardening (aiClient.ts) — this must
 * never be reachable in a real deployment, only in the test process. */
export function setStorageProviderOverrideForTests(provider: StorageProvider | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("setStorageProviderOverrideForTests must never be called when NODE_ENV=production");
  }
  overrideForTests = provider;
}
