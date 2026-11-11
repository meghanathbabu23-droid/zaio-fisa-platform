import { ProctoringCaptureTier } from "@prisma/client";

/**
 * Minimum bytes for tier VERIFIED_REAL (non-empty blob only — not playable A/V validation).
 * API padding or truncated WebM can satisfy this; do not treat as genuine recording proof.
 */
export const MIN_VERIFIED_REAL_BYTES = 1024;

const WEBM_EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

export function classifyRecordingBuffer(buffer: Buffer): ProctoringCaptureTier {
  if (buffer.length === 0) {
    return ProctoringCaptureTier.INVALID_EMPTY;
  }
  if (buffer.length < MIN_VERIFIED_REAL_BYTES) {
    return ProctoringCaptureTier.DEMO_UNVERIFIED;
  }
  return ProctoringCaptureTier.VERIFIED_REAL;
}

export function isLikelyWebm(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).equals(WEBM_EBML);
}

export function webcamStatusAfterUpload(tier: ProctoringCaptureTier): string {
  switch (tier) {
    case ProctoringCaptureTier.VERIFIED_REAL:
      return "stored_verified_real";
    case ProctoringCaptureTier.DEMO_UNVERIFIED:
      return "stored_demo_unverified";
    case ProctoringCaptureTier.INVALID_EMPTY:
      return "invalid_empty";
    default:
      return "unknown";
  }
}
