import {
  blobToBase64,
  finalizeRecordings,
  getProctoringSessionId,
  clearProctoringSessionId,
  setProctoringSignalHandler,
  startScreenRecording as startScreenRecordingRuntime,
  startWebcamMicRecording as startWebcamMicRecordingRuntime,
} from "./proctoringRuntime";
import {
  completeRecordingUpload,
  endProctoringSession,
  postProctoringEvent,
  uploadRecordingChunk,
} from "../api";
import { ChunkUploader, type RecordingKind } from "./chunkUploader";
import { IndexedDbChunkStore } from "./chunkStore";
import { getStudentId } from "./session";

/** Lazily constructed — importing this module must never touch IndexedDB
 * (e.g. in a test environment that lacks it); only actually starting a
 * recording does. One shared ChunkUploader per page load, keyed by nothing
 * else since each session's chunks are already namespaced by sessionId. */
let sharedUploader: ChunkUploader | null = null;
function getChunkUploader(): ChunkUploader {
  if (!sharedUploader) {
    sharedUploader = new ChunkUploader(new IndexedDbChunkStore(), async (sessionId, kind, seq, sha256, blob) => {
      const dataBase64 = await blobToBase64(blob);
      await uploadRecordingChunk(sessionId, kind, seq, sha256, dataBase64);
    });
  }
  return sharedUploader;
}

/**
 * Call on entering the authenticated student area (see StudentRoute.tsx) —
 * resumes any chunk uploads left pending by a tab crash or browser restart
 * in a prior visit, scoped to the student currently logged in on this
 * browser. Safe to call before any recording session exists (resolves to 0
 * with nothing to do) and safe to call more than once (ChunkUploader itself
 * de-dupes concurrent sweeps). Never throws — a failure here must not block
 * the app loading, and any chunk it couldn't reach stays safely in
 * IndexedDB for the next attempt.
 */
export async function resumePendingProctoringUploads(): Promise<number> {
  const studentId = getStudentId();
  if (!studentId) return 0; // no authenticated student context yet — nothing safe to resume
  try {
    // Exclude whatever session is actively recording right now, if any —
    // its chunks are already being handled in real time by enqueueChunk;
    // sweeping them here too would just race the live upload pointlessly.
    const activeSessionId = getProctoringSessionId();
    return await getChunkUploader().resumePendingUploads(studentId, activeSessionId);
  } catch {
    return 0;
  }
}

function makeOnChunk(kind: RecordingKind) {
  return (sequenceNumber: number, blob: Blob) => {
    const sessionId = getProctoringSessionId();
    const studentId = getStudentId();
    if (!sessionId || !studentId) return;
    void getChunkUploader().enqueueChunk(sessionId, kind, sequenceNumber, blob, studentId);
  };
}

/** Same signature/behavior as proctoringRuntime's own export, but wired to
 * upload each chunk incrementally via IndexedDB + retry instead of only
 * accumulating in memory. Page call sites should import this one. */
export function startWebcamMicRecording(): Promise<void> {
  return startWebcamMicRecordingRuntime(makeOnChunk("WEBCAM_MIC"));
}

export function startScreenRecording(): Promise<boolean> {
  return startScreenRecordingRuntime(makeOnChunk("SCREEN"));
}

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

/** Waits for every chunk this session produced to finish uploading, then
 * tells the server to assemble the final recording. If chunks are still
 * mid-upload (or mid-retry) when this is called, it logs that explicitly
 * rather than losing them — resumePendingProctoringUploads() picks them up
 * again on the next app load, and the server-side session simply stays
 * "incomplete" in the meantime rather than silently missing. */
async function completeIncrementalRecording(sessionId: string, kind: RecordingKind) {
  const uploader = getChunkUploader();
  const progress = await uploader.getProgress(sessionId, kind);
  if (progress.total === 0) {
    await logProctoringEvent("UPLOAD_SKIPPED_EMPTY", `${kind}: no chunks produced.`);
    return;
  }
  const result = await uploader.completeSession(
    sessionId,
    kind,
    (sid, k, expectedChunkCount, mimeType) => completeRecordingUpload(sid, k, expectedChunkCount, mimeType),
    "video/webm"
  );
  if (result.ok) {
    await logProctoringEvent(
      "UPLOAD_OK_INCREMENTAL",
      `${kind}: incremental upload completed (${progress.total} chunks).`
    );
  } else {
    await logProctoringEvent(
      "UPLOAD_PENDING",
      `${kind}: ${progress.uploaded}/${progress.total} chunks uploaded when session ended — will resume automatically.`
    );
  }
}

export async function uploadAndEndProctoring() {
  const id = getProctoringSessionId();
  if (!id) return;
  await logProctoringEvent("EXAM_END", "Stopping recordings and closing proctoring session.");
  // Stops the recorders and flushes each one's final chunk through the same
  // onChunk hook used throughout — finalizeRecordings()'s returned blobs are
  // unused here (the in-memory arrays it reads from stay empty when the
  // incremental onChunk path is active, by design).
  await finalizeRecordings();
  await completeIncrementalRecording(id, "WEBCAM_MIC");
  await completeIncrementalRecording(id, "SCREEN");
  await endProctoringSession(id);
  clearProctoringSessionId();
}
