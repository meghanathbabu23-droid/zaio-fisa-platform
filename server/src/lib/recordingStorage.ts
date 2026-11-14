import path from "node:path";
import { getStorageProvider } from "./storage/index.js";

const ROOT = path.join(process.cwd(), "data", "recordings");

export function recordingPath(sessionId: string, filename: string): string {
  return path.join(ROOT, sessionId, filename);
}

/** Provider-agnostic key for the StorageProvider interface — relative, never
 * the absolute filesystem path recordingPath() returns (that stays local-
 * disk-specific and is only used by evidenceSync.ts's existing, unchanged
 * local-disk read path). */
function storageKey(sessionId: string, filename: string): string {
  return path.join(sessionId, filename);
}

export async function saveRecordingFile(
  sessionId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  await getStorageProvider().save(storageKey(sessionId, filename), buffer);
  return recordingPath(sessionId, filename);
}
