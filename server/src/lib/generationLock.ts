/**
 * Per-admin single-flight lock for exam generation jobs — same in-memory
 * Map pattern as server/src/lib/rateLimit.ts, kept in its own file rather
 * than added to that one since rateLimit.ts is OTP-specific and this has
 * nothing to do with OTP/auth. Correct and sufficient for a single Node
 * process (this app's current deployment shape); if FISA ever runs
 * multiple instances, swap this for a shared store at that point.
 *
 * This solves "an admin double-clicked Generate," not distributed
 * idempotency — there's no retry-with-same-key scenario to solve here, so
 * no idempotency-key scheme is needed on top of it.
 */

const inFlight = new Set<string>();

/** Returns true and marks the lock held if this admin had no job running;
 * returns false if one was already in flight. */
export function tryAcquireGenerationLock(adminId: string): boolean {
  if (inFlight.has(adminId)) return false;
  inFlight.add(adminId);
  return true;
}

export function releaseGenerationLock(adminId: string): void {
  inFlight.delete(adminId);
}

/** Test-only: clear all in-memory lock state between test cases. Refuses
 * outright in production, same fail-closed reasoning as
 * aiClient.ts's setAiClientOverrideForTests — this escape hatch's safety
 * never rests solely on "nothing in production code happens to call it". */
export function resetGenerationLockStateForTests(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("resetGenerationLockStateForTests must never be called when NODE_ENV=production");
  }
  inFlight.clear();
}
