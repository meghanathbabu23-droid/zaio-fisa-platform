import path from "node:path";
import { LocalDiskStorageProvider } from "./localDiskStorageProvider.js";
import { resolveStorageMode } from "./resolveStorageMode.js";
import { S3StorageProvider } from "./s3StorageProvider.js";
import type { StorageProvider } from "./types.js";

/**
 * A separate StorageProvider instance from getStorageProvider() (recordings)
 * — same abstraction and same provider classes, reused as-is, but exam
 * assets are a different domain (static, exam-level, non-sensitive files)
 * from proctoring recordings (per-session, sensitive), so they get their
 * own root on local disk and their own key prefix under S3, never sharing
 * either with recordings.
 */
const EXAM_ASSETS_ROOT = path.join(process.cwd(), "data", "exam-assets");

let overrideForTests: StorageProvider | null = null;
let cached: StorageProvider | null = null;

function buildProvider(): StorageProvider {
  const mode = resolveStorageMode();
  if (mode === "s3") {
    return new S3StorageProvider({
      bucket: process.env.S3_BUCKET ?? "",
      region: process.env.S3_REGION ?? "",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      endpoint: process.env.S3_ENDPOINT || undefined,
    });
  }
  return new LocalDiskStorageProvider(EXAM_ASSETS_ROOT);
}

export function getExamAssetStorageProvider(): StorageProvider {
  if (overrideForTests) return overrideForTests;
  if (!cached) cached = buildProvider();
  return cached;
}

/** Mirrors setStorageProviderOverrideForTests' hardening (storage/index.ts)
 * — this must never be reachable in a real deployment, only in the test
 * process. */
export function setExamAssetStorageProviderOverrideForTests(provider: StorageProvider | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("setExamAssetStorageProviderOverrideForTests must never be called when NODE_ENV=production");
  }
  overrideForTests = provider;
}
