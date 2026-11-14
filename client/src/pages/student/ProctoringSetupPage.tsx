import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  activateProctoringSession,
  createProctoringSession,
  postProctoringEvent,
} from "../../api";
import {
  isScreenRecorderActive,
  isWebcamRecorderActive,
  setProctoringSessionId,
  testScreenCapture,
} from "../../student/proctoringRuntime";
import { startScreenRecording, startWebcamMicRecording } from "../../student/proctoringHelpers";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { StateBanner } from "../../components/ui/StateBanner";

type Check = "camera" | "mic" | "screen";

export function ProctoringSetupPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [search] = useSearchParams();
  const next = search.get("next") === "practical" ? "practical" : "mcq";
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<Check, "pending" | "ok" | "fail">>({
    camera: "pending",
    mic: "pending",
    screen: "pending",
  });
  const [screenNote, setScreenNote] = useState<string>("");
  const [realWebcam, setRealWebcam] = useState(false);
  const [realScreen, setRealScreen] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!assignmentId) return;
    createProctoringSession(assignmentId)
      .then((r) => {
        setSessionId(r.sessionId);
        setProctoringSessionId(r.sessionId);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not start session"));
  }, [assignmentId]);

  async function runDeviceChecks() {
    if (!sessionId) return;
    setError(null);
    try {
      await startWebcamMicRecording();
      if (!isWebcamRecorderActive()) {
        throw new Error("MediaRecorder did not start with live camera and microphone tracks.");
      }
      setChecks((c) => ({ ...c, camera: "ok", mic: "ok" }));
      await postProctoringEvent(
        sessionId,
        "PERMISSION_GRANTED",
        "Camera and microphone granted; tracks live."
      );
      const screenTest = await testScreenCapture();
      setScreenNote(screenTest.detail);
      if (screenTest.ok) {
        setChecks((c) => ({ ...c, screen: "ok" }));
        await postProctoringEvent(sessionId, "SCREEN_CHECK_OK", screenTest.detail);
      } else {
        setChecks((c) => ({ ...c, screen: "fail" }));
        await postProctoringEvent(sessionId, "SCREEN_CHECK_FAIL", screenTest.detail);
      }
    } catch (e) {
      setChecks({ camera: "fail", mic: "fail", screen: "pending" });
      const msg = e instanceof Error ? e.message : "Permission denied";
      setError(msg);
      await postProctoringEvent(sessionId, "PERMISSION_DENIED", msg);
    }
  }

  async function beginRecording() {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      if (checks.camera !== "ok" || checks.mic !== "ok") {
        try {
          await runDeviceChecks();
        } catch {
          /* runDeviceChecks sets error */
        }
      }

      let webcamOk = isWebcamRecorderActive();
    if (!webcamOk && checks.camera === "ok") {
      try {
        await startWebcamMicRecording();
        webcamOk = isWebcamRecorderActive();
      } catch (e) {
        webcamOk = false;
        const msg = e instanceof Error ? e.message : "Webcam/mic unavailable";
        setError(msg);
      }
    }

    if (webcamOk) {
      await postProctoringEvent(
        sessionId,
        "WEBCAM_RECORDING_ACTIVE",
        "MediaRecorder started with live webcam and microphone tracks (demo disk storage only)."
      );
    } else {
      await postProctoringEvent(
        sessionId,
        "WEBCAM_RECORDING_UNAVAILABLE",
        "Real webcam/mic recording is not active — no camera/mic or MediaRecorder could not start."
      );
    }

    let screenOk = false;
    if (webcamOk) {
      screenOk = await startScreenRecording();
      if (screenOk && isScreenRecorderActive()) {
        await postProctoringEvent(
          sessionId,
          "SCREEN_RECORDING_STARTED",
          "Screen MediaRecorder started with live display track."
        );
      } else {
        screenOk = false;
        await postProctoringEvent(
          sessionId,
          "SCREEN_RECORDING_SKIPPED",
          "Screen recording not started (denied, unsupported, or no live track)."
        );
      }
    } else {
      await postProctoringEvent(
        sessionId,
        "SCREEN_RECORDING_SKIPPED",
        "Screen recording skipped — real webcam/mic capture required first in this demo flow."
      );
    }

    await activateProctoringSession(sessionId, {
      webcamRecording: webcamOk,
      screenRecording: screenOk,
    });
      setRealWebcam(webcamOk);
      setRealScreen(screenOk);
      setSessionReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording setup failed");
    } finally {
      setLoading(false);
    }
  }

  function enterExam() {
    if (!assignmentId || !sessionReady) return;
    void postProctoringEvent(sessionId!, "EXAM_ENTERED", `Navigating to ${next} exam.`);
    const path =
      next === "practical"
        ? `/student/practical/${assignmentId}`
        : `/student/exam/${assignmentId}`;
    navigate(path);
  }

  return (
    <div className="min-h-screen bg-zaio-paper px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <Link to="/student" className="text-sm text-zaio-blue">
            ← My exams
          </Link>
          <h1 className="mt-2 font-display text-2xl font-semibold">Exam proctoring setup</h1>
          <p className="mt-1 text-sm text-zaio-ink/60">
            <strong>Demo only.</strong> Advisory monitoring never changes marks. Stored files are{" "}
            <strong>not</strong> certified evidence unless marked <em>verified capture</em> after
            upload checks.
          </p>
        </div>

        {sessionReady ? (
          <StateBanner tone={realWebcam || realScreen ? "success" : "warning"}>
            {realWebcam || realScreen ? (
              <>
                <strong>Real capture active:</strong>{" "}
                {realWebcam ? "webcam/mic MediaRecorder running. " : ""}
                {realScreen ? "Screen MediaRecorder running." : ""}
              </>
            ) : (
              <>
                <strong>Real recording unavailable.</strong> You may continue the exam; only
                advisory events will be logged unless you fix devices and re-run setup on a new
                assignment attempt.
              </>
            )}
          </StateBanner>
        ) : null}

        <Card>
          <h2 className="font-display text-sm font-semibold text-zaio-ink">Safe Exam Browser (SEB)</h2>
          <p className="mt-2 text-sm text-zaio-ink/70">
            For high-stakes delivery, configure SEB to allow only this application address:{" "}
            <code className="text-xs">{window.location.origin}</code>. The Vite dev server uses port
            5173 when that port is free, and the next free port when it is not — allow the origin
            shown here, not a guessed port. Disable spell check and external apps, and require a quit
            password. Distribute a{" "}
            <code className="text-xs">.seb</code> file generated from the SEB configuration tool — not
            enforced in this browser demo.
          </p>
        </Card>

        <section className="rounded-xl border border-zaio-sun/40 bg-zaio-sun/10 p-5">
          <h2 className="font-display text-sm font-semibold text-zaio-ink">Zoom second-camera</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zaio-ink/80">
            <li>Join the cohort Zoom link from your facilitator on a phone or tablet.</li>
            <li>Position the rear camera to show your screen, keyboard and desk.</li>
            <li>Keep the device plugged in and unobstructed for the full exam.</li>
            <li>This demo does not verify Zoom attendance — follow facilitator instructions.</li>
          </ol>
        </section>

        <Card>
          <h2 className="font-display text-sm font-semibold text-zaio-ink">Device check</h2>
          <ul className="mt-3 space-y-2 text-sm text-zaio-ink/80">
            <CheckRow label="Camera" state={checks.camera} />
            <CheckRow label="Microphone" state={checks.mic} />
            <CheckRow label="Screen share test" state={checks.screen} hint={screenNote} />
          </ul>
          {(checks.camera === "fail" || checks.mic === "fail") && (
            <p className="mt-3 text-sm text-amber-900">
              Real webcam/mic recording is <strong>unavailable</strong> until permissions and devices
              work. The exam can still be opened after you run setup (events only).
            </p>
          )}
          <p className="mt-3 text-xs text-zaio-ink/50">
            Screen + webcam: Chromium browsers usually allow parallel capture; Safari often blocks
            simultaneous screen and tab recording. Firefox may stop screen share when switching tabs.
          </p>
          <Button type="button" variant="secondary" className="mt-4" onClick={() => void runDeviceChecks()}>
            Run permission checks
          </Button>
        </Card>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            disabled={loading || !sessionId}
            onClick={() => void beginRecording()}
          >
            {loading ? "Preparing…" : "Prepare session & recording"}
          </Button>
          <Button type="button" variant="sun" disabled={!sessionReady} onClick={enterExam}>
            Continue to exam
          </Button>
        </div>
      </div>
    </div>
  );
}

function CheckRow({
  label,
  state,
  hint,
}: {
  label: string;
  state: "pending" | "ok" | "fail";
  hint?: string;
}) {
  const icon = state === "ok" ? "✓" : state === "fail" ? "✗" : "…";
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="w-6 text-center font-mono">{icon}</span>
      <span>{label}</span>
      {hint ? <span className="text-xs text-zaio-ink/50">— {hint}</span> : null}
    </li>
  );
}
