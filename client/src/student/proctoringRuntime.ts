export type ChunkHandler = (sequenceNumber: number, blob: Blob) => void;

type RecorderBag = {
  sessionId: string | null;
  webcamStream: MediaStream | null;
  screenStream: MediaStream | null;
  webcamRecorder: MediaRecorder | null;
  screenRecorder: MediaRecorder | null;
  webcamChunks: Blob[];
  screenChunks: Blob[];
  webcamSeq: number;
  screenSeq: number;
};

let onProctoringSignal: ((type: string, message: string) => void) | null = null;

const bag: RecorderBag = {
  sessionId: null,
  webcamStream: null,
  screenStream: null,
  webcamRecorder: null,
  screenRecorder: null,
  webcamChunks: [],
  screenChunks: [],
  webcamSeq: 0,
  screenSeq: 0,
};

/** Client-side minimum before attempting upload (matches server tier logic). */
export const MIN_UPLOAD_BYTES = 1024;

export function setProctoringSignalHandler(
  fn: ((type: string, message: string) => void) | null
) {
  onProctoringSignal = fn;
}

function signal(type: string, message: string) {
  onProctoringSignal?.(type, message);
}

function watchStreamTracks(stream: MediaStream, label: string) {
  stream.getTracks().forEach((track) => {
    track.onended = () => {
      signal(
        "RECORDING_INTERRUPTED",
        `${label} track ended (user revoked permission or device disconnected). Advisory only.`
      );
    };
    track.onmute = () => {
      signal("PERMISSION_OR_DEVICE_CHANGE", `${label} track muted. Advisory only.`);
    };
  });
}

export function setProctoringSessionId(id: string) {
  bag.sessionId = id;
}

export function getProctoringSessionId(): string | null {
  return bag.sessionId;
}

export function clearProctoringSessionId() {
  bag.sessionId = null;
}

function pickMime(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}

function streamHasLiveTracks(stream: MediaStream): { video: boolean; audio: boolean } {
  const video = stream
    .getVideoTracks()
    .some((t) => t.readyState === "live" && t.enabled && !t.muted);
  const audio = stream
    .getAudioTracks()
    .some((t) => t.readyState === "live" && t.enabled && !t.muted);
  return { video, audio };
}

function waitForRecorderStart(recorder: MediaRecorder, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (recorder.state === "recording") {
      resolve();
      return;
    }
    const timeout = window.setTimeout(() => {
      reject(new Error(`${label} MediaRecorder did not enter recording state`));
    }, 4000);
    recorder.addEventListener(
      "start",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
    recorder.addEventListener(
      "error",
      () => {
        window.clearTimeout(timeout);
        reject(new Error(`${label} MediaRecorder error`));
      },
      { once: true }
    );
  });
}

export function isWebcamRecorderActive(): boolean {
  if (!bag.webcamStream || !bag.webcamRecorder) return false;
  if (bag.webcamRecorder.state !== "recording") return false;
  const tracks = streamHasLiveTracks(bag.webcamStream);
  return tracks.video && tracks.audio;
}

export function isScreenRecorderActive(): boolean {
  if (!bag.screenStream || !bag.screenRecorder) return false;
  if (bag.screenRecorder.state !== "recording") return false;
  return bag.screenStream.getVideoTracks().some((t) => t.readyState === "live" && t.enabled);
}

/**
 * onChunk, when provided, receives every chunk with its sequence number
 * instead of it being pushed into the in-memory webcamChunks array — this
 * is what lets a caller persist/upload incrementally rather than holding
 * the whole recording in memory. When omitted, behavior is byte-for-byte
 * what it always was (array accumulation, consumed later by
 * finalizeRecordings()) — existing callers are unaffected.
 */
export async function startWebcamMicRecording(onChunk?: ChunkHandler): Promise<void> {
  stopStreams();
  bag.webcamChunks = [];
  bag.webcamSeq = 0;
  bag.webcamStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 } },
    audio: true,
  });
  const tracks = streamHasLiveTracks(bag.webcamStream);
  if (!tracks.video || !tracks.audio) {
    stopStreams();
    throw new Error("Camera or microphone track is not live — real recording unavailable.");
  }
  const mime = pickMime();
  bag.webcamRecorder = new MediaRecorder(bag.webcamStream, { mimeType: mime });
  bag.webcamRecorder.ondataavailable = (e) => {
    if (e.data.size === 0) return;
    if (onChunk) {
      onChunk(bag.webcamSeq, e.data);
      bag.webcamSeq += 1;
    } else {
      bag.webcamChunks.push(e.data);
    }
  };
  bag.webcamRecorder.onerror = () => {
    signal("RECORDING_ERROR", "Webcam/mic MediaRecorder error (advisory).");
  };
  watchStreamTracks(bag.webcamStream, "Webcam/mic");
  bag.webcamRecorder.start(4000);
  await waitForRecorderStart(bag.webcamRecorder, "Webcam/mic");
}

export async function testScreenCapture(): Promise<{
  ok: boolean;
  detail: string;
  canRecordWithWebcam: boolean;
}> {
  try {
    const screen = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    const webcamActive = isWebcamRecorderActive();
    screen.getTracks().forEach((t) => t.stop());
    return {
      ok: true,
      detail: webcamActive
        ? "Screen share granted while webcam recorder is active (browser allowed both)."
        : "Screen share granted (webcam not running during test).",
      canRecordWithWebcam: webcamActive,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "Screen capture denied or unsupported",
      canRecordWithWebcam: false,
    };
  }
}

export async function startScreenRecording(onChunk?: ChunkHandler): Promise<boolean> {
  try {
    bag.screenChunks = [];
    bag.screenSeq = 0;
    bag.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    if (!bag.screenStream.getVideoTracks().some((t) => t.readyState === "live")) {
      bag.screenStream.getTracks().forEach((t) => t.stop());
      bag.screenStream = null;
      return false;
    }
    watchStreamTracks(bag.screenStream, "Screen");
    const mime = pickMime();
    bag.screenRecorder = new MediaRecorder(bag.screenStream, { mimeType: mime });
    bag.screenRecorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      if (onChunk) {
        onChunk(bag.screenSeq, e.data);
        bag.screenSeq += 1;
      } else {
        bag.screenChunks.push(e.data);
      }
    };
    bag.screenRecorder.onerror = () => {
      signal("RECORDING_ERROR", "Screen MediaRecorder error (advisory).");
    };
    bag.screenRecorder.start(4000);
    await waitForRecorderStart(bag.screenRecorder, "Screen");
    return isScreenRecorderActive();
  } catch {
    return false;
  }
}

export function stopStreams() {
  [bag.webcamRecorder, bag.screenRecorder].forEach((r) => {
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    }
  });
  [bag.webcamStream, bag.screenStream].forEach((s) => {
    s?.getTracks().forEach((t) => t.stop());
  });
}

export async function finalizeRecordings(): Promise<{
  webcam: Blob | null;
  screen: Blob | null;
}> {
  await new Promise<void>((resolve) => {
    let pending = 0;
    const done = () => {
      pending -= 1;
      if (pending <= 0) resolve();
    };
    if (bag.webcamRecorder && bag.webcamRecorder.state !== "inactive") {
      pending += 1;
      bag.webcamRecorder.onstop = done;
      bag.webcamRecorder.stop();
    }
    if (bag.screenRecorder && bag.screenRecorder.state !== "inactive") {
      pending += 1;
      bag.screenRecorder.onstop = done;
      bag.screenRecorder.stop();
    }
    if (pending === 0) resolve();
  });

  [bag.webcamStream, bag.screenStream].forEach((s) => {
    s?.getTracks().forEach((t) => t.stop());
  });

  const webcam =
    bag.webcamChunks.length > 0
      ? new Blob(bag.webcamChunks, { type: bag.webcamChunks[0].type || "video/webm" })
      : null;
  const screen =
    bag.screenChunks.length > 0
      ? new Blob(bag.screenChunks, { type: bag.screenChunks[0].type || "video/webm" })
      : null;

  bag.webcamRecorder = null;
  bag.screenRecorder = null;
  bag.webcamStream = null;
  bag.screenStream = null;
  bag.webcamChunks = [];
  bag.screenChunks = [];

  return { webcam, screen };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
