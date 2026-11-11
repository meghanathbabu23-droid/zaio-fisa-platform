# Manual Proctoring & Recording Test — Chrome on macOS

This checklist is for a human to run on a real MacBook with Chrome, a working camera and microphone, and screen-sharing permission granted to Chrome in System Settings → Privacy & Security. **Nothing in this document can be executed by an automated agent** — no cloud/CI environment has a camera, microphone, or a screen to share, so every step here requires you personally.

Do this on a **disposable test student**, not Jordan, Amahle, Priya, Sipho, or Zoe — create one from the admin Students page first (e.g. "Test Student", any `@example.com` email), assign both a MCQ and a practical exam to them, and delete that student afterward if you want the DB tidy. This protects the real Nov 14 cohort from any state changes.

**Note:** the practical workspace now looks like a dark (or light, via the toolbar toggle) IDE — file explorer, tabs, resizable editor/preview — instead of the earlier plain three-pane layout. None of that visual redesign touched the camera/mic/screen-capture code this checklist exercises, so every step below is unchanged and still accurate. The proctoring setup page (where you grant camera/mic/screen permission) was not restyled in that redesign and still looks as described.

Before you start: `npm run dev` running, admin on `http://localhost:5173`, API on `http://localhost:3001`.

---

## What "pass" means here

A recording **existing on disk with a non-trivial size is not proof it's a valid, playable video**. The server only checks byte count (`server/src/lib/recordingVerify.ts:7,11-19` — ≥1024 bytes ⇒ `VERIFIED_REAL`, explicitly documented in the code as "not playable A/V validation"). The only way to actually confirm a recording is real is to **open the file and watch/listen to it yourself** in step 7 below. Don't mark anything PASS from a file-size number or an "Evidence: PRESENT" label alone.

---

## 1. Camera and microphone permission prompt

1. Log in as your test student (OTP shown on page), go to **My exams**, click **Start (proctoring)** on the MCQ or practical assignment.
2. On the proctoring setup page, click **Run permission checks**.
3. **Expect:** Chrome shows its native camera+microphone permission bar (not a custom in-app dialog — this is the real OS/browser prompt). Click **Allow**.
4. **Expect:** the "Camera" and "Microphone" rows on the page both show ✓ within a few seconds.

**If you click Block instead:** the page should show both as ✗, display an error message, and still let you click **Prepare session & recording** / **Continue to exam** — the exam must still open. This is the one thing you should deliberately test once (see §8).

---

## 2. Webcam/mic recording actually starts

Immediately after step 1 succeeds, the code also silently runs a screen-capture **test** (not yet the real recording) — see §3. Then:

5. Click **Prepare session & recording**.
6. **Expect:** a green banner "**Real capture active:** webcam/mic MediaRecorder running." If you instead see an amber "Real recording unavailable" banner, something is wrong — stop and check the browser console for errors before continuing.
7. While the banner is green, your camera's recording indicator (the little light/icon macOS shows when a camera is in use) should be lit. This is your independent confirmation that a real `getUserMedia` stream is live, not just a UI claim.

---

## 3. Screen-sharing prompt and recording — **expect two separate share prompts, not one**

This is a real behavior of the code, not a bug — know it ahead of time so you don't think something's broken:

- **First prompt**, during step 2 ("Run permission checks"): the app calls `getDisplayMedia` once just to test whether screen sharing is possible at all (`proctoringRuntime.ts:147-173`, `testScreenCapture`), then immediately releases that stream a moment later. Pick any window/screen here.
- **Second prompt**, during step 5 ("Prepare session & recording"): the app calls `getDisplayMedia` again (`proctoringRuntime.ts:175-202`, `startScreenRecording`) to start the recording that actually runs for the rest of the exam. Pick the window/screen you actually want recorded here — this is the one that matters.

8. **Expect:** after the second prompt, the green banner also says "Screen MediaRecorder running." and the browser's own screen-share indicator (Chrome shows a border/bar around the shared content, plus a system-level "sharing your screen" indicator) is visible.

**Note:** screen recording only starts if webcam/mic succeeded first (`ProctoringSetupPage.tsx:118,134-139`) — this is an intentional dependency in this demo, not a bug. If you deny the camera, screen recording will be skipped entirely, by design.

---

## 4. Simultaneous webcam + screen capture

9. With both banners green from §2 and §3, open the Proctoring Monitor admin page in a second browser/tab and confirm the session shows `webcamStatus: capturing_real` and `screenStatus: capturing_real` simultaneously.
10. Work in the exam for 1–2 minutes with both running.

**Expect on Chrome/macOS:** both should run concurrently without either stopping — the code never stops one to start the other (confirmed by reading `proctoringRuntime.ts` — `startScreenRecording` never touches the webcam stream/recorder, and vice versa). This is a code guarantee, but the actual OS/browser behavior can still surprise you — **this step is the one most worth actually watching closely**, since Safari and Firefox are known to behave differently here (not something you need to test today, just know that Chrome-only behavior is what's been verified).

---

## 5. Exam submission and recording upload

11. Finish the exam (answer MCQ questions / write some practical code) and submit.
12. **Expect:** on submit, the page calls `uploadAndEndProctoring()` — this stops both recorders, assembles everything recorded so far into two files (webcam+mic, screen), uploads each, then ends the session. There may be a brief pause here while the upload happens — **don't close the tab during this pause** (see §7 on why that matters).
13. **Expect:** no error banner. The exam's normal "submitted" screen appears.

**Important — keep this test recording SHORT (a few minutes), not a full 60–120 minute exam.** See §9 below for exactly why.

---

## 6. Recording file existence

14. In a terminal: `ls -la server/data/recordings/` — find the newest directory (it's named after the proctoring session id).
15. `ls -la server/data/recordings/<that-session-id>/` — you should see one or two files, e.g. `webcam_mic-<timestamp>.webm` and/or `screen-<timestamp>.webm` (exact naming from `server/src/lib/recordingStorage.ts:6-7` and `server/src/routes/proctoring.ts:187-188`).
16. Check the file size (`ls -la`) — it should be meaningfully larger than 1KB for a multi-minute real recording. (Remember: size alone still isn't proof of validity — that's §7.)

---

## 7. Playback and download — the actual proof

17. Open that `.webm` file directly (double-click in Finder, or `open server/data/recordings/<session>/<file>.webm`) in QuickTime Player or Chrome itself.
18. **Expect:** you can actually see your own webcam video and hear audio (for the webcam/mic file), and actually see your screen content (for the screen file). **This is the only real verification in this entire checklist — everything else is metadata.** If the file won't open or is silent/blank, the recording is not valid regardless of what Evidence says.
19. In the admin **Evidence** page, open this test assignment's row and click the recording artifact's download link. Confirm it downloads the same file (compare file size/timestamp to step 15–16).

---

## 8. Permission revocation, browser refresh, network interruption

Run each of these as a **separate** attempt (don't try to chain all three in one exam run):

**8a. Deny camera/mic entirely.**
- Start a fresh proctoring setup, click **Run permission checks**, click **Block** on the browser prompt.
- **Expect:** Camera/Mic show ✗, an amber "Real recording unavailable" message appears, but **Continue to exam** is still clickable and the exam opens normally. Afterward, check Evidence for this assignment: the recording artifact should show **MISSING**, not PRESENT or SIMULATED-as-if-real.

**8b. Revoke permission or stop sharing mid-exam.**
- Start a session with webcam successfully recording (§2), then **mid-exam**, click Chrome's screen-share "Stop sharing" bar (if screen was running), or revoke camera permission from the address-bar padlock icon.
- **Expect:** an advisory event should appear in Evidence/Proctoring Monitor shortly after (`RECORDING_INTERRUPTED` or `PERMISSION_OR_DEVICE_CHANGE`, from `proctoringRuntime.ts:36-48`). The exam UI itself should **not** freeze, crash, or block you from continuing to type/answer — confirm you can still submit normally afterward.
- **This is a real gap to watch for, not assume works:** the code reacts to the track ending via an event listener, but does not explicitly stop the dead `MediaRecorder` or attempt to salvage whatever was recorded before the interruption. Confirm the exam stays usable; don't expect a graceful "recording recovered" message — there isn't one, and that's expected.

**8c. Browser refresh mid-exam.**
- Mid-exam, with recording active, refresh the page (Cmd+R).
- **Expect:** you'll be dropped back to the proctoring setup page (recording state lives only in page memory — a refresh always loses it, by design). Your exam answers/code should **not** be lost, since those autosave to the server independently of proctoring. Whatever was recorded before the refresh is lost (same reason as §9 below) — there is no recovery.

**8d. Network interruption.**
- Mid-exam, disconnect Wi-Fi for ~15 seconds, then reconnect.
- **Expect:** an advisory `NETWORK_OFFLINE` then `NETWORK_ONLINE` event (from `proctoringHelpers.ts:38-41`). Confirm the exam editor/MCQ UI doesn't hard-fail — autosave should simply retry/succeed once back online. If the interruption happens to coincide with the final submit-time upload, that upload could fail outright (see §9) — that's expected, not a regression.

---

## 9. Why you should keep test recordings short — a real, unfixed limitation

This isn't something for you to test — it's something to **understand before you demo**, so a long real recording doesn't silently fail at the worst possible moment:

- The webcam/mic and screen recordings are held **entirely in browser memory** for the whole exam (`proctoringRuntime.ts` — chunks accumulate in an in-page array, `ondataavailable` fires every 4 seconds via `.start(4000)`). **Nothing is uploaded until the student finally submits.** If the tab closes, the browser crashes, or the laptop loses power at any point before that final submit, **100% of the recording captured so far is lost** — not just the last few seconds.
- There is **no bitrate cap** set on the recorder (`new MediaRecorder(stream, { mimeType })`, no `videoBitsPerSecond` option) and **no periodic/incremental upload** during the exam.
- The server rejects any single recording upload over **20MB raw** (`proctoring.ts:173-176`), and in practice the Express body-size limit (25MB on the base64-encoded JSON payload, `index.ts:27-28`) bites slightly earlier — the real usable ceiling is **roughly 18–19MB of actual recorded video+audio data**, in one upload, for the webcam file and separately for the screen file.
- Browser-default encoding bitrate for webcam+screen video is not fixed in this code, so a **real continuous recording for a full 60–120 minute exam is a genuine risk of exceeding that ceiling** — if it does, the *entire* recording for that stream is rejected with a 413 at the very end of the exam, after the student has already submitted and the workspace is locked. The student's exam submission itself is unaffected (recording upload failure never blocks or reverts the exam submission — confirmed in `proctoringHelpers.ts:92-107`), but the recording evidence for that session would then correctly show as missing.

**Recommendation for the 14th (not implemented — needs your/Asif's approval if you want it changed):** when demonstrating real camera/screen recording, keep that specific run to a few minutes (open setup → record briefly → submit), rather than running a real recording for the full advertised exam duration. This stays safely under the upload ceiling and avoids an end-of-exam surprise. A proper fix (capping the recorder's bitrate, or streaming chunks to the server periodically instead of buffering them all in memory) is a real architectural change — flagging it here per your instruction not to make that kind of change without asking first.
