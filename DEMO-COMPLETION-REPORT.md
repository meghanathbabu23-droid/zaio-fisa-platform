# Zaio FISA Platform — Demo Completion Report

Verification pass requested after Asif Hassam's 10 November meeting. This report re-verifies every requirement against the actual code and a live running instance — it does not assume any earlier summary was correct. Every classification below is backed by either a direct code citation, a live test run against the running server, or an explicit note that it needs a human with real camera/mic/screen hardware.

**Legend:** `PASS` verified working · `PARTIAL` implemented but with a known, scoped gap · `NOT DONE` missing · `MANUAL` requires a human with real hardware/browser to confirm.

No data was deleted, no database was migrated, and nothing was committed or pushed. All checks against the live server used either the real Nov 14 cohort (read-only) or disposable test cohorts I created and deleted myself.

---

## 0. Visual redesign — Zaio brand & IDE editor (code-level verification only)

Three follow-up passes since the verification below, all visual/UI only — no backend, scoring, proctoring, or data logic touched in any of them. None of them were visually opened in a browser by the assistant (no Chrome extension connection available in this environment); every result below is TypeScript/build/smoke-test verified, not eyeballed.

| Change | Status | Evidence |
|---|---|---|
| Zaio brand redesign — real logo assets, Future Blue/Ink/Paper/secondary palette, Space Grotesk/Inter typography, consistent status badges across admin + student portal | **PASS (code)** / **MANUAL (visual)** | Official logo/mark/favicon SVGs downloaded from the live brand sheet (not recreated or guessed), design tokens centralised in `client/src/index.css`, shared `Button`/`Badge`/`Card`/`StateBanner`/`Modal` primitives replacing ad hoc styling across ~25 files. `tsc --noEmit` and `npm run build` clean; `demo-smoke.mjs` 8/8 after. No route, handler, `confirm`/`alert` dialog, or status value changed — re-checked by direct grep of the preserved lines after editing each file. |
| Practical workspace dark-IDE redesign — file explorer sidebar, file tabs, syntax-highlighted CodeMirror, resizable editor/preview split | **PASS (code)** / **MANUAL (visual)** | Same CodeMirror instance and `extensionsFor` language-detection logic, unchanged. Theme built from `@codemirror/view` / `@codemirror/language` / `@lezer/highlight` (already-present transitive dependencies, now made explicit in `package.json`). Preserved-behaviour grep re-run clean: both `window.confirm` calls, both `window.prompt` calls, all four `if (!assignmentId \|\| locked) return` guards, `readOnly={locked}`, the iframe's exact `sandbox="allow-scripts"` and sizing classes. |
| Dark Mode / Light Mode toggle for the practical editor | **PASS (code)** / **MANUAL (visual)** | Toggle swaps a CodeMirror extensions array through the library's own compartment-reconfiguration mechanism (documented `@uiw/react-codemirror` behaviour: reconfigures without recreating the `EditorView`), so file/content/cursor/autosave state is untouched by construction, not just by intent. Preference stored in `localStorage` only (no code, answers, or PII), defaults to Dark Mode, independent of `locked`/submission state. Same preserved-behaviour grep re-run clean after this change too. |

**What "code-level verification" does and doesn't prove**, same caveat as the camera/mic/screen work below: `tsc`/`vite build` prove the code compiles and that the preserved conditions weren't accidentally altered in a way that still type-checks — they do **not** prove the colours, spacing, logo sizing, contrast, or the toggle actually look right or render correctly on screen. That needs a human to open the app in a real browser. See the final checklist in §10.

---

## 1. Student assessment workflow

| Requirement | Status | Evidence |
|---|---|---|
| OTP login and student sessions | **PASS** | `server/src/routes/auth.ts` — hashed OTP, 10-min expiry, single-use, 8h session token. Live-tested: request → verify → bearer token → `/api/student/assignments`. Re-requesting an OTP invalidates the previous unconsumed one. |
| Assigned exam listing and instructions | **PASS** | `StudentHomePage.tsx` lists assignments by status; instructions render from `exam.instructions`. Live-tested against both the real Nov 14 cohort (Amahle's 2 ASSIGNED rows) and a disposable test student. |
| Timed MCQ assessment and submission | **PASS** | Server-derived countdown from stored `attempt.startedAt` (`studentPortal.ts`) — a page refresh cannot extend time. Live-tested: start → load with timer → submit → correct auto-scoring (100% on correct answers). **Fixed today:** forced auto-submit on timeout no longer silently defaults unanswered questions to option 0 (`McqExamPage.tsx`) — they're now sent unanswered and scored wrong, as they should be. |
| HTML/CSS/JS multi-file editor | **PASS** | CodeMirror 6 (`@uiw/react-codemirror` + html/css/javascript language packages) in `PracticalExamPage.tsx`. File list with create/rename/delete, each backed by real routes in `practical.ts`. |
| Live preview | **PASS** | Sandboxed iframe (`sandbox="allow-scripts"`) fed by `buildPreviewDocument` (`client/src/lib/preview.ts`), which assembles the HTML/CSS/JS into one document. |
| Autosave and recovery | **PASS** | 1200ms-debounced autosave to `PUT .../autosave`, upserts files in a transaction, flips `ASSIGNED→IN_PROGRESS`. Recovery is server-authoritative: reloading the workspace always returns the last-saved files. Live-tested. |
| Practical submission and workspace locking | **PASS** | Submission snapshots files, sets `lockedAt`, flips status to `SUBMITTED`, runs auto-assessment. All five mutating routes (autosave, create/rename/delete file, submit) check the lock. Live-tested: submit → locked → further autosave correctly rejected with 400. **Fixed today:** submit is now atomic (see §5) — a burst of 5 concurrent submit requests produced exactly one 200 and four clean 400 "Already submitted" responses, with no double-scoring. |

---

## 2. Proctoring

| Requirement | Status | Evidence |
|---|---|---|
| Camera and microphone permissions | **PASS** (code) / **MANUAL** (real device) | `ProctoringSetupPage.tsx` runs real device checks and surfaces real permission errors; exam still opens on denial (verified by design and by a live test where I logged a genuine `WEBCAM_PERMISSION_DENIED` event with no camera hardware present). A human still needs to click "Allow"/"Block" on a real browser prompt to see the UX. |
| Real MediaRecorder startup | **PASS** | `waitForRecorderStart` (`proctoringRuntime.ts`) confirms `state === "recording"` via the recorder's own `start` event (4s timeout), not an assumed flag. Applies identically to webcam and screen recorders. |
| Webcam and microphone recording | **PASS** (code) / **MANUAL** (real capture) | Real `getUserMedia`, live-track verification, real `MediaRecorder`, real blob upload → disk → DB row. Code-complete; needs a human with a real camera/mic to confirm the actual video/audio is legible. |
| Screen recording via getDisplayMedia | **PASS** (code) / **MANUAL** (real capture) | `getDisplayMedia({ video: true, audio: false })`, same confirmed-start pattern as webcam. Code-complete; needs a human to confirm the real OS share-picker UX and resulting footage. |
| Simultaneous capture | **PASS** (architecture) / **MANUAL** (cross-browser) | Traced the actual call sequence: webcam starts and is confirmed first, then screen capture starts independently — neither stops the other, so both `MediaRecorder`s run concurrently once started. This is genuinely supported by the code. Whether it actually works smoothly varies by browser (Chromium generally yes; Safari/Firefox can behave differently) — **a human must test this in the actual browser you'll demo on.** |
| Recording upload and local storage | **PASS** | Base64 upload → server decodes, size-classifies (`INVALID_EMPTY`/`DEMO_UNVERIFIED`/`VERIFIED_REAL` by byte size only — explicitly documented in code as *not* real A/V validation), writes to `server/data/recordings/<session>/`, creates a `ProctoringRecording` row. Oversize (21MB) upload correctly rejected with 413. |
| Timestamped proctoring events | **PASS** | Every event (visibility change, offline/online, exam load/end, upload outcome, page unload) is timestamped server-side on write. Live-tested with a real logged event. |
| Recording error and interrupted-session handling | **PARTIAL** | `onerror` handlers and `track.onended`/`onmute` listeners exist for both recorders and do log advisory events (real gap closed). **Real remaining gap:** on tab close/crash, in-progress recording blobs sitting only in memory are never flushed or uploaded — they're simply lost. **Fixed today:** the one best-effort `PAGE_UNLOAD` event log now uses `fetch(..., { keepalive: true })` so it's actually likely to be delivered before the tab closes (previously a plain fetch with no delivery guarantee). Flushing the recording data itself on unload would need a different streaming architecture — documented as a known limitation, not fixed, since it's a scope-level redesign, not a bug fix. |
| Recording reliability under tab-close/crash/network loss, and upload-size limits | **PARTIAL — quantified today** | Both webcam/mic and screen chunks accumulate **only in browser memory** for the entire exam (`proctoringRuntime.ts` — `.start(4000)`, 4-second chunk interval, held in an in-page array) and are uploaded in one shot only at final submit (`uploadAndEndProctoring`, `proctoringHelpers.ts:92-107`). **Any tab close, crash, or power loss before that final submit discards the entire recording captured so far, not just the last few seconds.** No bitrate cap is set on either `MediaRecorder` (no `videoBitsPerSecond` option), and there is no periodic/incremental upload. Server-side, a single recording upload is capped at **20MB raw** (`proctoring.ts:173-176`), and the Express body-size limit (25MB on the base64 JSON payload, `index.ts:27-28`) bites slightly earlier in practice — the real usable ceiling is **roughly 18–19MB of actual video+audio per file**. A real continuous recording for a full 60–120 minute exam is a genuine risk of exceeding that ceiling at browser-default bitrates, which would reject that recording's upload with a 413 at the very end of the exam (the exam submission itself is unaffected either way). **Not fixed** — a proper fix (bitrate cap or streaming uploads) is an architectural change outside today's scope; flagging per your explicit instruction not to make that kind of change without approval. Practical mitigation documented in `MANUAL-RECORDING-TEST.md` §9: keep any real-recording demo run short. |
| Evidence integration, accurate labels | **PASS** | `evidenceSync.ts` never auto-labels a recording `PRESENT` — only `MISSING` or `SIMULATED`, by deliberate design, regardless of the size-tier classification. Live-tested: a test assignment with zero uploaded recordings correctly showed `PROCTORING_RECORDING: MISSING` and `PROCTORING_EVENTS: SIMULATED` in Evidence. |

**No recordings were fabricated at any point in this verification.** I read `scripts/e2e-audit.mjs` and confirmed it manufactures a synthetic 1024-byte buffer and uploads it as a fake "recording" — I did not run it, per your instruction. Every proctoring check above used either a genuine (if hardware-less, thus denied/absent) browser API call path or none at all.

**Exactly what you must test manually, on the real browser/device you'll demo with:** see `MANUAL-RECORDING-TEST.md` for the full step-by-step checklist (permissions, recording start, the two separate screen-share prompts you should expect, simultaneous capture, upload, file playback, and deliberately testing permission revocation/refresh/network loss). In short: grant camera+mic and screen, confirm both recorders run together, submit, then **actually open and play the resulting `.webm` file** — file existence or an "Evidence: PRESENT"-looking label is not proof of a valid recording, only watching/listening to it is.

---

## 3. Admin and assessment management

| Requirement | Status | Evidence |
|---|---|---|
| Dashboard and cohort management | **PASS** | Create/edit/delete all call real endpoints (`cohorts.ts`) and re-fetch from the server after each write — not optimistic-only state. |
| Student management | **PASS** | Same pattern (`students.ts`), live-tested create + delete via API. |
| Exam creation and assignments | **PASS** | MCQ questions and practical test cases both persist via real routes; single and bulk-cohort assignment both create real `ExamAssignment` rows (`assignments.ts`). Live-tested full creation chain (cohort → student → MCQ exam w/ questions → practical exam w/ test cases → 2 assignments). |
| Assessor reviews | **PASS** | Live-tested: practical submission appeared in the assessor queue with correct automated score; posting a final score persisted and showed up correctly in Results. |
| Moderation decisions | **PASS** | Live-tested: moderation case auto-created on submission, correctly PENDING with no advisory flags (8-point score gap, under the 15-point threshold); recording a decision flipped it to COMPLETED. Jordan's real advisory flag (`INCOMPLETE_ASSESSOR_REVIEW`) is still present and correct. |
| Results dashboard and Excel export | **PASS** | `exportResults.ts` builds the workbook strictly from the live `rows` state already fetched from the API — no mock data. Columns: Student, Email, Cohort, Exam, Exam type, Assignment status, Review state, MCQ %, Practical automated %, Assessor-approved %, Assessor feedback, Assigned, Submitted. |
| Evidence dashboard and downloads | **PASS** | Download links are plain `<a href>` tags pointing at real server endpoints (`evidence.ts`), not client-built fake blobs. `exportEvidence.ts` is the same live-data pattern as results. |

No dead UI was found anywhere in the admin app — every button traced to a real, mounted Express route.

---

## 4. Database — Supabase vs MongoDB

**No change made. Recommendation only, pending your/Asif's confirmation.**

**Recommendation: Supabase (Postgres).**

The schema (23 Prisma models) is fully relational by design: foreign keys everywhere, `onDelete: Cascade` in ~15 places, five separate 1:1 relations enforced via `@@unique` off `ExamAssignment`, and 9 enums used for correctness (exam type, assignment/moderation status, evidence kind/status, proctoring tiers, etc.).

- **Postgres/Supabase**: swap `provider = "postgresql"` in `schema.prisma`, point `DATABASE_URL` at Supabase, run `prisma migrate dev`, copy rows with a small Prisma-to-Prisma script. Enums, cascades, and uniqueness constraints carry over natively, zero rework.
- **MongoDB**: Prisma's Mongo connector doesn't support `onDelete: Cascade` — every one of those ~15 cascades would need to become manual application code. Native enum/uniqueness enforcement at the DB level would be lost. Every id becomes an `ObjectId`. There's no unstructured/document-shaped data in this schema to justify the switch — the handful of JSON-ish fields (`options`, `answers`, `filesSnapshot`, `metaJson`, etc.) are already plain strings and map trivially to Postgres `text`/`jsonb`.

When you confirm Supabase, the migration is low-risk and can be done in small, verifiable steps (push empty schema → copy script → row-count verification → smoke test on the new DB → cutover), keeping the SQLite file as a rollback copy.

---

## 5. Security and data integrity

| Check | Status | Evidence |
|---|---|---|
| No secrets or env files exposed | **PASS** | `git ls-files \| grep -iE '\.env$\|\.db$\|recordings/'` returns nothing. `git check-ignore -v` confirms `.gitignore` rules correctly catch `server/.env`, `server/prisma/*.db`, and `server/data/`. |
| No recordings or DB files in Git | **PASS** | Same check as above — none tracked. |
| Recording download path validation | **PASS** | `resolveSafeRecordingPath` (`evidenceSync.ts`) normalizes and requires the result to stay inside the recordings root. Live-tested against the compiled code: `"../../etc/passwd"` and `"/etc/passwd"` both correctly rejected (`null`), a valid in-root path correctly resolved. Confirmed wired into the real download route, not dead code. |
| No duplicate MCQ attempts | **PASS** | `McqAttempt.assignmentId` is `@unique`; a second `start` call hits a Prisma unique-constraint error, caught, and the existing attempt/timer is reused — never reset or duplicated. |
| No accidental overwriting of submitted answers | **FIXED** (was a confirmed narrow gap) | The "already submitted" check previously ran *before* the database transaction, leaving a theoretical window where two concurrent submit requests could both pass the check. **Fixed today** for both MCQ and practical submit: the status/lock flip is now an atomic conditional update inside the transaction itself. Live-tested by firing 5 concurrent submits at one assignment: exactly one 200 (scored once), four clean 400 "Already submitted" — no double-scoring, no 500s. |
| Nov 14 cohort and 5 students / 10 assignments intact | **PASS** | Re-verified via `npm run smoke:demo` before and after every change made today: Nov 14 cohort present, 5 students, 2 exams, 10 assignments, 10 evidence rows, Amahle's fresh OTP/assignment state unchanged, Jordan's submitted/finalised state unchanged. |
| No fabricated recordings or false evidence statuses | **PASS** | No recording bytes were fabricated at any point today. `e2e-audit.mjs` (which does fabricate a synthetic recording) was read but deliberately not run. Evidence statuses observed during live testing were always accurate to what actually happened (MISSING when nothing was uploaded, SIMULATED for the events/recording labeling design). |

### Missing authentication / production security limitations — superseded, see §11

Everything in this subsection as originally written ("the entire admin API is unauthenticated," "CORS is fully open," "no rate limiting anywhere") described the platform's state in an earlier pass and **no longer reflects the current code**. Admin access now requires an individually-authenticated account with role-based permissions, CORS is an explicit origin allow-list, and rate limiting exists on OTP and admin-login endpoints. See **§11** for what changed, what's verified, and what's still outstanding (real provider credentials). No hardcoded secrets or credentials were found anywhere in the codebase at any point, including in this pass.

---

## 6. Fixes applied today (all small, verified, no scope change)

1. `client/src/pages/student/McqExamPage.tsx` — forced timeout-submit no longer silently answers unanswered questions with option 0.
2. `server/src/routes/practical.ts` — removed a dead-code `if` branch with an empty body (no behavioral change; cosmetic clarity).
3. `server/src/routes/studentPortal.ts` — MCQ submit is now atomic (conditional `updateMany` guard inside the transaction), closing the double-submit race.
4. `server/src/routes/practical.ts` — practical submit is now atomic (same pattern, guarding on `PracticalWorkspace.lockedAt`).
5. `client/src/api.ts` + `client/src/student/proctoringHelpers.ts` — the page-unload advisory event now sends with `keepalive: true` so it's actually likely to be delivered before the tab closes.

Both `server` and `client` pass `tsc --noEmit` cleanly after every change. `npm run build` (both halves) succeeds. `npm run smoke:demo` passes before and after. No data was lost; the Nov 14 cohort was re-verified intact after each change.

---

## 7. Demo startup (unchanged from DEMO-RUNBOOK.md, re-verified accurate)

```bash
cp -n .env.example server/.env
npm install
npm run db:push
npm run seed:demo
npm run dev
```

- Admin: http://localhost:5173
- Student sign-in: http://localhost:5173/student/login
- API: http://localhost:3001

`npm run seed:demo` is safe to re-run — it refreshes the Nov 14 cohort without touching other records. **Do not run `scripts/e2e-audit.mjs` before the demo** — it creates extra audit cohorts and a fabricated recording file, confirmed by reading its source today.

For the step-by-step physical-device checklist referenced throughout §2, see `MANUAL-RECORDING-TEST.md` — it covers Chrome-on-macOS permission prompts, the two separate screen-share dialogs to expect, simultaneous capture, upload, file playback/download, and deliberate permission-revocation/refresh/network-loss tests. None of it could be executed by this assistant — no camera, microphone, or screen exists in this environment to test with.

## 8. Walkthrough and Loom sequence

Use the existing `DEMO-RUNBOOK.md` 12-minute walkthrough as-is — every behavior it describes was re-verified live today:

1. **Dashboard** — Nov 14 badge, programme, 14 Nov 2026 exam date.
2. **Cohorts → Students** — open Nov 14 cohort, show the five `@student.zaio.io` learners.
3. **Exams** — both Nov 14 exams (MCQ + PRACTICAL).
4. **Assignments** — ten Nov 14 rows: eight ASSIGNED, Jordan's two SUBMITTED.
5. **Results** (filter: Nov 14) — Jordan's MCQ 100% finalised; practical 100% automated, assessor blank, pending review.
6. **Assessor** — open Jordan; automated 100%, three passed checks, assessor-approved still pending. Don't save a score unless you want it to go live in Moderation.
7. **Moderation** — Pending filter, inspect Jordan: automated 100%, assessor blank, one advisory flag (flags never change marks).
8. **Proctoring** — read the simulated-storage banner, turn off "Show active sessions only," show Jordan's sessions (no recording files uploaded).
9. **Evidence** (filter: Nov 14) — open Jordan's practical row: submission present, recordings MISSING, event logs SIMULATED.
10. **Student sign-in** as Amahle — simulated-OTP banner, type the on-page demo code.
11. **My exams** — Amahle's two ASSIGNED assignments, "Start (proctoring)" buttons.

State out loud at the start that OTP delivery and recording storage are both simulated for this demo — confirmed accurate by everything verified above.

---

## 9. Bottom line

This platform is **demo-ready for everything that can be verified without physical camera/mic/screen hardware**, and I'm not claiming more than that. Every student, admin, and data-integrity requirement in Asif's list is either **PASS** with live evidence above, or a precisely-named **MANUAL** item for you to click through yourself, or a precisely-named, intentionally-undone limitation (security hardening) that's a scope decision, not an oversight. Nothing was fabricated, nothing demo-critical was left silently unverified.

---

## 10. Final demonstration checklist

One concise pass over everything Asif's list touches, after the brand/IDE redesign in §0. **Verified** = a live test against the running server, or a direct code/build check, in this session. **Still manual** = needs you, on the real browser/device, before or during the demo — nothing here was faked, assumed, or skipped silently.

| Area | Verified | Still manual / pending your check |
|---|---|---|
| **Student login (OTP)** | OTP request → verify → session token, live-tested end-to-end; simulated-delivery banner logic confirmed in code | Visual check of the re-branded sign-in page, and that the on-screen demo code is actually legible |
| **MCQ assessment** | Server-side timer, auto-submit-on-timeout, scoring, and submission are all live-tested; the unanswered-question auto-fill bug (§1) stays fixed | Visual check of the question list, timer, and the new status badges on "My exams" |
| **Practical coding workspace** | Multi-file CodeMirror editor, autosave, file create/rename/delete, and submission locking are all live-tested and unchanged by the redesign (re-confirmed by grep); the Dark/Light toggle's state-preservation is verified by how `@uiw/react-codemirror` reconfigures extensions, not by assumption | Opening it in a real browser: does the dark/light IDE actually look right, does the toggle switch instantly without losing code or cursor position, does the resizable split drag smoothly, does the live preview still render correctly in both themes |
| **Webcam/microphone recording** | Real `getUserMedia`/`MediaRecorder` code path, confirmed-start pattern (listens for the recorder's own `start` event), upload → disk → DB row — all code-verified; no physical camera exists in this environment | Full manual pass per `MANUAL-RECORDING-TEST.md` §1–2: permission prompts, the camera's hardware recording indicator, and — the only real proof — actually playing back the resulting file |
| **Screen capture** | Real `getDisplayMedia` code path, same confirmed-start pattern, simultaneous-capture architecture traced line-by-line and confirmed non-conflicting with the webcam recorder | Full manual pass per `MANUAL-RECORDING-TEST.md` §3–4: the two separate share prompts, and a real check that screen + webcam actually run together on the browser you'll present with |
| **Admin dashboard** | Cohorts/students/exams/assignments/results all live-tested against real endpoints, not mock data; brand redesign (logo, tables, cards, buttons) is code/build-verified | Visual check of the new logo placement, sidebar, and table styling |
| **Assessor review** | Automated scoring, assessor-approved score persistence, and review history all live-tested; redesign preserved every handler (re-confirmed by grep) | Visual check of the redesigned review screen's layout and contrast |
| **Moderation** | Auto-created moderation cases, advisory flags, and decision recording all live-tested; "flags never change marks" confirmed in code and live | Visual check of the redesigned moderation queue and detail pages |
| **Evidence management** | PRESENT/MISSING/SIMULATED labelling, audit trail, path-traversal protection, and downloads all live-tested against real data; status-badge consolidation (§0) kept the same enum→label mapping | Visual check of the redesigned evidence table/detail pages, plus the recording-playback step above |

Nothing in the UI/IDE work broke any of the logic above — every line it could plausibly have touched was re-checked by name after each edit, and `npm run build` + `node scripts/demo-smoke.mjs` passed cleanly before and after every pass. What remains is exactly what has remained throughout: a human opening the real app in a real browser, and a human testing real camera/mic/screen hardware. Nothing was fabricated, reset, or committed to produce this report.

---

## 11. Individual administrator accounts, RBAC, and real OTP delivery tooling (this pass)

This pass replaced the interim shared `ADMIN_API_KEY` (added between the original report above and now) with individual administrator accounts, cookie-based sessions, and four-role RBAC, and built the (never-auto-run) tooling for testing real Resend/Twilio delivery. **Nothing was committed or pushed; the database was backed up before the one schema migration applied.**

### Administrator accounts and RBAC

| Requirement | Status | Evidence |
|---|---|---|
| Individual accounts, hashed passwords | **PASS** | `Administrator` model (`server/prisma/schema.prisma`) — unique email, `passwordHash` (bcryptjs, 12 rounds, via `server/src/lib/adminPassword.ts`), role, active flag, lockout metadata, timestamps. No plaintext password is ever stored, logged, or returned — checked directly in `adminAuth.test.ts`. |
| Cookie-based sessions, not localStorage | **PASS** | `fisa_admin_session` — httpOnly, `SameSite=Lax`, `Secure` in production (`server/src/lib/adminSession.ts`). Nothing admin-related touches `localStorage`/`sessionStorage` on the client (`client/src/admin/session.ts` only reads a non-sensitive CSRF cookie value). |
| CSRF protection | **PASS** | Stateless double-submit cookie (`fisa_admin_csrf` cookie must match `X-CSRF-Token` header on every mutating request) — `requireAdminAuth` middleware. Live-tested: missing header → 403, mismatched header → 403, GET without it → fine. |
| Login lockout / throttling | **PASS** | 5 wrong attempts locks the account 15 minutes (`423`, distinct from the generic `401`); a separate per-IP limiter on `/api/admin/login` (10/15min in production). Both live-tested in `requireAdmin.test.ts` / `adminAuth.test.ts` / `rateLimit.test.ts`. |
| Enumeration resistance | **PASS** | Wrong password and nonexistent email return byte-identical `401` responses — asserted directly in `adminAuth.test.ts`. |
| Password change / reset | **PASS** | Change-password revokes every *other* session, keeps the current one. Reset is a single-use, 30-minute token (SHA-256 hash stored, raw token only ever in the email) that revokes **all** sessions on confirm. Both fully live-tested including reuse-after-confirm rejection. |
| Safe one-time bootstrap | **PASS** | `server/scripts/bootstrap-admin.ts` — requires `--email --name` (nothing invented), refuses once any administrator exists, enforces password strength. The password is **not** a CLI argument — it's typed at an interactive prompt (hidden at a real terminal, no echo at all, like `sudo`), confirmed by retyping; passing `--password` is explicitly rejected with an explanation. Verified as a real subprocess against disposable databases in `bootstrapAdmin.test.ts` (create succeeds once via piped stdin, refuses a second time, rejects missing args, rejects a weak password, rejects `--password` on the command line, rejects a mismatched confirmation). **The real `server/prisma/dev.db` still has zero administrators** — I did not invent credentials or bootstrap it myself; that first account is yours to create. |
| Super-admin self-lockout prevention | **PASS** | `server/src/routes/adminUsers.ts` blocks three self-actions on `PUT /api/admin/users/:id`: deactivating your own account, deleting your own account, and — added in this follow-up pass — **changing your own role**, which was the one real gap found when asked to confirm this explicitly (a lone SUPER_ADMIN demoting themselves would have had no API left to undo it). Revoking your own sessions is allowed (it just logs out the current session; the password still works for a fresh login) — confirmed by test, not assumed. All four behaviors are directly tested in `adminUsers.test.ts`. |
| Four-role RBAC, server-enforced | **PASS** | `SUPER_ADMIN`/`ADMIN`/`ASSESSOR`/`MODERATOR` via layered `requireAdminAuth` + `requireRole(...)` in `server/src/app.ts`, with extra per-route tightening (e.g. only `SUPER_ADMIN` can write to `/api/exams`, `/api/exams/:id/practical-tests`, or toggle a cohort's OTP eligibility, even though `ADMIN` can read/use the rest of those routers). Live-tested per route per role (both the allowed and the 403 case) in `requireAdmin.test.ts`'s route sweep. |
| Audit trail | **PASS** | `AdminAuditLog` — login/logout, student/cohort/exam CRUD, OTP-eligibility changes, assessor reviews, moderation decisions, evidence view/download/export, administrator account changes, and session revocation all write a row identifying the acting admin, action, target, and timestamp. `adminId` is nullable with `onDelete: SetNull` so deleting an admin doesn't erase their history — verified directly in `adminUsers.test.ts`. The helper that writes this table takes no field that could carry a password/OTP/key/token. |
| Admin UI (login, logout, lockout/expiry feedback, role-aware nav, unauthorized page, password change, admin management) | **PASS (code)** / **MANUAL (visual)** | `AdminLoginPage`, `AdminRoute`/`AdminAuthContext` (session-expiry via `/api/admin/me` + a 401 listener), `AdminLayout` (nav filtered by role), `Unauthorized`/`RequireRole`, `AdminAccountPage` (password change), `AdminUsersPage` (SUPER_ADMIN-only CRUD + session revocation). 27 frontend tests cover login success/failure/lockout-wording/loading state, session-expiry fallback, role-filtered nav for all four roles, and the Unauthorized page's per-role redirect target. Not yet opened in a real browser by the assistant (same caveat as §0). |

### Database migration

One additive Prisma migration (`20261110143357_add_administrator_rbac_audit`) added four new tables (`Administrator`, `AdminSession`, `AdminPasswordResetToken`, `AdminAuditLog`) — no existing table, column, or row was altered. `server/prisma/dev.db` was copied to `server/prisma/backups/` (gitignored) immediately before applying it. Row counts for every pre-existing table (Student 17, Cohort 11, Exam 25, ExamAssignment 31, OtpToken 51, StudentSession 26, EvidenceRecord 31) were identical before and after. The Nov 14 demo cohort and all five seeded students were not touched.

### Real email/SMS delivery (Objective 1)

The Resend/Twilio adapters, the dual mock/live + per-cohort eligibility gate, and the sanitized delivery-failure logging were already in place from an earlier pass and remain unchanged here. This pass added:

- A SUPER_ADMIN-only status endpoint (`GET /api/admin/status/delivery`) showing delivery mode, whether provider config is valid, and per-cohort eligibility — never a secret value.
- `server/scripts/test-live-delivery.ts` — sends exactly one real email and/or SMS to a recipient given explicitly on the command line (`--confirm` required, refuses outside live mode with full valid credentials, never reads the database, never touches a student). **I did not run it.** There are no Resend/Twilio credentials anywhere in this environment (`server/.env`'s provider fields are all empty) — reconfirmed again in a later follow-up pass: the command correctly refused with "OTP_DELIVERY_MODE is 'mock', not 'live'" when tried under the current config, and separately refused with all five credentials listed as missing when `OTP_DELIVERY_MODE=live` was forced. **No real email or SMS has been sent or received by anyone, ever, in any pass — that remains entirely untested**, and `docs/PROVIDER-SETUP.md` says so plainly rather than implying otherwise. The exact command to run once you've supplied real credentials AND authorized specific recipients is:
  ```bash
  cd server
  npm run test:live-delivery -- --email <authorized-recipient@example.com> --sms <+1authorizedE164number> --confirm
  ```
  I have not filled in real recipients above and will not run this myself — it needs your explicit authorization of who receives it.
- `docs/PROVIDER-SETUP.md`, including the explicit Twilio-trial-account caveat you asked me not to assume away.

### Testing

- Backend: **183/183** passing (`cd server && npm test`), including every pre-existing test plus new coverage for bootstrap (including the hidden-prompt flow and its failure modes), login/lockout/enumeration, password change/reset, RBAC per route per role (including the practical-test-case write-tightening route, added when asked to confirm coverage was exhaustive), self-lockout prevention (deactivate/delete/role-change blocked, session revocation allowed), CSRF, audit-trail writes, and the generic email/SMS provider methods.
- Frontend: **27/27** passing (`cd client && npm test`), covering the admin auth UI listed above.
- `tsc --noEmit` clean on both halves; `npm run build` clean on both halves.
- `npm run smoke:demo` was **not** re-run this pass — it now needs a real administrator login (`DEMO_SMOKE_ADMIN_EMAIL`/`DEMO_SMOKE_ADMIN_PASSWORD`), and per the bootstrap constraint above I didn't create one myself. It's updated to use the new login flow and will work once you bootstrap an admin and pass those two env vars.

### What's left for you

1. **Bootstrap the first administrator** — `cd server && npm run bootstrap-admin -- --email ... --name "..."`, then type the password at the prompt when asked (see `docs/ADMIN-SETUP.md`). Nothing else admin-related works end-to-end on a fresh checkout until this is done.
2. **Re-run `npm run smoke:demo`** with `DEMO_SMOKE_ADMIN_EMAIL`/`DEMO_SMOKE_ADMIN_PASSWORD` set to that account, to get a fresh end-to-end pass including the new login step.
3. **Real Resend/Twilio credentials**, if you want to demonstrate actual email/SMS delivery — see `docs/PROVIDER-SETUP.md`. Until then, and for the Nov 14 cohort regardless, delivery stays on mock by design.
4. **Open the new admin screens in a real browser** — follow `docs/BROWSER-VERIFICATION-CHECKLIST.md` step by step. I attempted this myself and could not: the Claude in Chrome extension wasn't connected in this environment, so — per your instruction not to claim visual verification without doing it — I'm reporting that it was **not performed**, not guessing that it probably works. The checklist also covers confirming student login is unaffected, which does NOT require any credential I'm barred from inventing — only a disposable test student, which the checklist tells you (or me, once the extension is connected) to create and delete, never a real one.

### Known limitations (admin auth, as of this pass)

- No UI to browse `AdminAuditLog` yet — direct DB access (e.g. Prisma Studio) only.
- No "break glass" recovery path if every SUPER_ADMIN is locked/deleted and you can't reach the database — recovery means editing the `Administrator` table directly.
- Password-reset email, like OTP email, is unreachable in mock mode outside of tests (captured in server memory only) — real recovery requires live Resend configuration.
