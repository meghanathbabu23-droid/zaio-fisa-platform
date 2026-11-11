import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(process.cwd(), "data", "recordings");

export function recordingPath(sessionId: string, filename: string): string {
  return path.join(ROOT, sessionId, filename);
}

export async function saveRecordingFile(
  sessionId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const dir = path.join(ROOT, sessionId);
  await mkdir(dir, { recursive: true });
  const full = path.join(dir, filename);
  await writeFile(full, buffer);
  return full;
}
