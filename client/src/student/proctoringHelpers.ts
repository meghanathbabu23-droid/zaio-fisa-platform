import {
  blobToBase64,
  finalizeRecordings,
  getProctoringSessionId,
  clearProctoringSessionId,
  setProctoringSignalHandler,
  MIN_UPLOAD_BYTES,
} from "./proctoringRuntime";
import { endProctoringSession, postProctoringEvent, uploadProctoringRecording } from "../api";

export async function logProctoringEvent(
  type: string,
  message: string,
  opts?: { keepalive?: boolean }
) {
  const id = getProctoringSessionId();
  if (!id) return;
  try {
    await postProctoringEvent(id, type, message, opts);
  } catch {
    /* advisory logging should not block exam */
  }
}

export function bindProctoringVisibility() {
  const onVis = () => {
    void logProctoringEvent(
      document.hidden ? "VISIBILITY_HIDDEN" : "VISIBILITY_VISIBLE",
      document.hidden
        ? "Exam tab hidden (advisory flag only — no automatic sanction)."
        : "Exam tab visible again."
    );
  };
  document.addEventListener("visibilitychange", onVis);
  return () => document.removeEventListener("visibilitychange", onVis);
}

/** Visibility, network, unload, and MediaStream interruption hooks for the active exam. */
export function bindProctoringExamMonitors() {
  setProctoringSignalHandler((type, message) => void logProctoringEvent(type, message));
  const offVis = bindProctoringVisibility();
  const onOffline = () =>
    void logProctoringEvent("NETWORK_OFFLINE", "Browser reported offline (advisory).");
  const onOnline = () =>
    void logProctoringEvent("NETWORK_ONLINE", "Browser reported online again.");
  const onUnload = () =>
    void logProctoringEvent(
      "PAGE_UNLOAD",
      "Learner left or closed the exam tab (advisory disconnect event).",
      { keepalive: true }
    );
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  window.addEventListener("beforeunload", onUnload);
  return () => {
    offVis();
    setProctoringSignalHandler(null);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("beforeunload", onUnload);
  };
}

async function tryUploadRecording(
  sessionId: string,
  kind: "WEBCAM_MIC" | "SCREEN",
  blob: Blob
) {
  if (blob.size === 0) {
    await logProctoringEvent(
      "UPLOAD_SKIPPED_EMPTY",
      `${kind}: empty blob after finalize — not uploaded.`
    );
    return;
  }
  if (blob.size < MIN_UPLOAD_BYTES) {
    await logProctoringEvent(
      "UPLOAD_SKIPPED_SMALL",
      `${kind}: ${blob.size} bytes below ${MIN_UPLOAD_BYTES}B minimum — not uploaded.`
    );
    return;
  }
  try {
    const dataBase64 = await blobToBase64(blob);
    const res = await uploadProctoringRecording(sessionId, kind, blob.type, dataBase64);
    const tier = (res as { captureTier?: string }).captureTier ?? "unknown";
    await logProctoringEvent(
      tier === "VERIFIED_REAL" ? "UPLOAD_OK_VERIFIED" : "UPLOAD_OK_UNVERIFIED",
      `${kind} uploaded (${blob.size} bytes, tier ${tier}).`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    await logProctoringEvent("UPLOAD_FAILED", `${kind}: ${msg}`);
  }
}

export async function uploadAndEndProctoring() {
  const id = getProctoringSessionId();
  if (!id) return;
  await logProctoringEvent("EXAM_END", "Stopping recordings and closing proctoring session.");
  const { webcam, screen } = await finalizeRecordings();
  if (webcam) {
    await tryUploadRecording(id, "WEBCAM_MIC", webcam);
  } else {
    await logProctoringEvent("UPLOAD_SKIPPED_EMPTY", "No webcam/mic blob produced.");
  }
  if (screen) {
    await tryUploadRecording(id, "SCREEN", screen);
  }
  await endProctoringSession(id);
  clearProctoringSessionId();
}
