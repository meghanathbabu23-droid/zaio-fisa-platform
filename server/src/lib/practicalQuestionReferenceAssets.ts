import { createHash } from "node:crypto";
import { prisma } from "../prisma.js";
import { getExamAssetStorageProvider } from "./storage/examAssetStorage.js";

/** jpg/jpeg/png images or a PDF only — matches the question's "optional
 * reference images/PDFs" requirement. SVG is deliberately excluded: a
 * correct SVG sanitizer is real work this feature doesn't need to take on
 * to satisfy that requirement. */
export const MAX_IMAGE_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_ASSET_BYTES = 20 * 1024 * 1024;

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(jpg|jpeg|png|pdf)$/;

export function isValidQuestionAssetFilename(filename: string): boolean {
  return FILENAME_RE.test(filename) && !filename.includes("..");
}

/** Sniffs the real content type from magic bytes — filename extension and
 * any client-supplied Content-Type are never trusted on their own. Returns
 * null for anything that doesn't match one of the three accepted formats. */
export function sniffQuestionAssetMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  return null;
}

export function maxBytesForMimeType(mimeType: string): number {
  return mimeType === "application/pdf" ? MAX_PDF_ASSET_BYTES : MAX_IMAGE_ASSET_BYTES;
}

function storageKey(questionId: string, sha256: string, filename: string): string {
  return `practical-questions/${questionId}/${sha256}-${filename}`;
}

export type QuestionAssetValidationError =
  | "INVALID_FILENAME"
  | "UNRECOGNIZED_FILE_TYPE"
  | "FILE_TOO_LARGE";

/**
 * Validates and stores a question reference asset, then upserts its DB row
 * keyed on the (questionId, filename) unique constraint — the same unique
 * index that makes this safe under concurrent uploads of the SAME filename
 * (an upsert on a unique key is atomic at the database level, so no
 * app-level lock is needed here, unlike the exam-asset/test-case-asset
 * "one document per scope regardless of filename" pattern elsewhere in this
 * codebase, which needs a lock precisely because that check-then-act logic
 * isn't expressible as a single unique constraint). Storage is written
 * BEFORE the DB row (content-addressed by sha256), so a crash between the
 * two never leaves a DB row pointing at missing bytes.
 */
export async function uploadPracticalQuestionReferenceAsset(
  questionId: string,
  filename: string,
  buffer: Buffer
): Promise<{ asset?: { filename: string; mimeType: string; sizeBytes: number }; error?: QuestionAssetValidationError }> {
  if (!isValidQuestionAssetFilename(filename)) {
    return { error: "INVALID_FILENAME" };
  }
  const mimeType = sniffQuestionAssetMimeType(buffer);
  if (!mimeType) {
    return { error: "UNRECOGNIZED_FILE_TYPE" };
  }
  if (buffer.length > maxBytesForMimeType(mimeType)) {
    return { error: "FILE_TOO_LARGE" };
  }

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const key = storageKey(questionId, sha256, filename);
  await getExamAssetStorageProvider().save(key, buffer);

  const row = await prisma.practicalQuestionReferenceAsset.upsert({
    where: { questionId_filename: { questionId, filename } },
    create: {
      questionId,
      filename,
      mimeType,
      sizeBytes: buffer.length,
      storageKey: key,
      sha256,
    },
    update: {
      mimeType,
      sizeBytes: buffer.length,
      storageKey: key,
      sha256,
    },
  });

  return { asset: { filename: row.filename, mimeType: row.mimeType, sizeBytes: row.sizeBytes } };
}

export async function deletePracticalQuestionReferenceAsset(
  questionId: string,
  filename: string
): Promise<boolean> {
  const existing = await prisma.practicalQuestionReferenceAsset.findUnique({
    where: { questionId_filename: { questionId, filename } },
  });
  if (!existing) return false;
  await getExamAssetStorageProvider().delete(existing.storageKey);
  await prisma.practicalQuestionReferenceAsset.delete({ where: { id: existing.id } });
  return true;
}

/** Called before deleting a PracticalQuestion row so no storage bytes are
 * orphaned (the DB rows themselves cascade-delete automatically). */
export async function purgePracticalQuestionReferenceAssetStorage(questionId: string): Promise<void> {
  const assets = await prisma.practicalQuestionReferenceAsset.findMany({ where: { questionId } });
  const provider = getExamAssetStorageProvider();
  for (const asset of assets) {
    await provider.delete(asset.storageKey);
  }
}
