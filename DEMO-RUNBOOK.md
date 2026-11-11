# Zaio FISA — 14 November demo runbook

Live walkthrough for Asif. Admin now requires signing in with an individual administrator account (see **Admin login** under Startup below) — there is no shared key or open access any more. Student sign-in uses a simulated (mock) OTP. Do not run `node scripts/e2e-audit.mjs` before the demo; it adds extra cohorts and a recording file.

The whole interface now carries the official Zaio brand (real logo, Future Blue/Ink/Paper palette, Space Grotesk/Inter typography, consistent status badges) instead of the earlier generic styling. The practical coding workspace was also redesigned into a VS Code–style IDE: a dark file explorer sidebar, file tabs across the top, syntax-highlighted CodeMirror editor, and a resizable split against the live preview — with a **Dark Mode / Light Mode toggle** in the workspace toolbar (defaults to Dark Mode, remembered per browser via `localStorage`, has no effect on the student's own HTML/CSS/JS output). All of this is code-verified (typecheck, build, smoke test) but **not yet visually confirmed in a real browser by the assistant** — see the final checklist in `DEMO-COMPLETION-REPORT.md` for exactly what that means for the 14th.

For the full verification status (what's PASS/PARTIAL/MANUAL and why) see `DEMO-COMPLETION-REPORT.md`. If you plan to actually demonstrate real camera/screen recording rather than just the simulated-storage messaging, run through `MANUAL-RECORDING-TEST.md` yourself beforehand on the machine and browser you'll present with — that can only be done by a human with a real camera, not by this assistant.

## Startup

From the repository root, with Node 22:

```bash
cp -n .env.example server/.env
npm install
npm run db:push
npm run seed:demo
npm run dev
```

`npm run seed:demo` is safe to run again. It refreshes the Nov 14 cohort and does not delete other records, submissions, or recordings.

### Admin login (one-time per machine)

Admin access requires an individual account — there is no shared key, default password, or open access. If this is a fresh checkout (or `server/prisma/dev.db` has no administrators yet), create the first one once, from `server/`:

```bash
cd server
npm run bootstrap-admin -- --email you@zaio.io --name "Your Name"
```

You'll be prompted for the password interactively (hidden, with confirmation) — it's never a command-line argument.

This refuses to run again once any administrator exists — see `docs/ADMIN-SETUP.md` for the full workflow (roles, adding more admins, password reset). Then sign in at the admin URL below with that email/password.

- Admin: http://localhost:5173
- Student sign-in: http://localhost:5173/student/login
- API: http://localhost:3001

Vite uses port 5173 when it is free. If that port is busy, use the local URL printed in the terminal. The Safe Exam Browser note on the proctoring page shows that same origin.

`server/.env` must keep `OTP_DELIVERY_MODE=mock` (the example file already does) for the demo cohort — real email/SMS delivery is implemented but deliberately not switched on for Nov 14. **The sign-in page no longer shows the code on screen** (an earlier security hardening pass removed that, so the code can never leak into a production response by accident) — retrieve it with the dev-only command in `docs/LOCAL-OTP-TESTING.md` instead:
```bash
curl -s "http://localhost:3001/api/test/last-otp?channel=EMAIL&value=amahle.dlamini@student.zaio.io"
```

## Demo cohort and students

Cohort: **Nov 14 Demo — HTML Programmer Skills**  
Programme: HTML Programmer Skills Programme (SP-230372)  
Exam date: 14 November 2026

On the dashboard, Recent cohorts keeps its start-date order. This cohort is badged **Nov 14 demo** and sits above that list when it is not already in the five newest rows. On Results, Evidence, and Assignments, filter or look for this name. Ignore rows named `Cohort audit-…`.

| Student | Email | Phone | What to show |
|---|---|---|---|
| Jordan Nkosi | jordan.nkosi@student.zaio.io | +27821110002 | Completed example |
| Amahle Dlamini | amahle.dlamini@student.zaio.io | +27821110001 | Fresh assigned student |
| Priya Pillay | priya.pillay@student.zaio.io | +27821110003 | Still assigned |
| Sipho Molefe | sipho.molefe@student.zaio.io | +27821110004 | Still assigned |
| Zoe van der Merwe | zoe.vandermerwe@student.zaio.io | +27821110005 | Still assigned |

Each student has two assignments:

- **FISA Knowledge — HTML, CSS & JavaScript (Nov 14 Demo)** — MCQ, 45 minutes, 8 questions, auto-marked
- **FISA Practical — HTML, CSS & JavaScript (Nov 14 Demo)** — practical, 120 minutes, 3 automated checks (`h1`, a `body` rule, `console.log`)

Jordan only:

- MCQ submitted, **100%** (8/8), review **Finalised**
- Practical submitted, automated **100%** (3/3), assessor score **not set**, review **Pending assessor review**
- Moderation **Pending**, one advisory flag: assessor-approved score is not recorded yet. The flag does not change the mark.
- Proctoring sessions exist. **No recording files** were stored. Evidence shows those recordings as **MISSING** and the event logs as **SIMULATED**.

Amahle, Priya, Sipho, and Zoe are **ASSIGNED** on both exams and have not started.

## 12-minute walkthrough

Stay on the Nov 14 filter once you set it. Say out loud that OTP delivery and proctoring storage are simulated.

| Time | Where | Do this | Expected |
|---|---|---|---|
| 0:00 | Dashboard | Point at the **Nov 14 demo** badge. | Cohort name, programme, exam 14 Nov 2026. Counts include older audit rows; that is expected. |
| 0:45 | Cohorts, then Students | Open the Nov 14 cohort, then show the five `@student.zaio.io` learners. | All five names, emails, and phones. No empty state. |
| 2:00 | Exams | Show both Nov 14 exams. | MCQ and PRACTICAL, linked to this cohort. |
| 3:00 | Assignments | Scroll to the ten Nov 14 rows. | Eight **ASSIGNED**. Jordan’s two are **SUBMITTED**. |
| 4:00 | Results | Cohort filter: **Nov 14 Demo — HTML Programmer Skills**. | 10 assignments, 2 submitted, 8 not started, 1 pending review, 1 finalised. Jordan MCQ **100%** finalised. Jordan practical automated **100%**, assessor blank, pending review. |
| 6:00 | Assessor | Open **Jordan Nkosi**. | Automated 100% and three passed checks. Assessor-approved score still pending. Do not save a score unless you want that change to show live in Moderation. |
| 7:30 | Moderation | Pending filter, then Inspect Jordan. | Status Pending. Automated 100%. Assessor blank. Advisory flag only. Copy says flags never change marks. |
| 8:30 | Proctoring | Read the simulated-storage banner. Turn off **Show active sessions only**. | Jordan’s sessions are listed. Each says **No recording files uploaded**. Nothing here is certified evidence. |
| 9:30 | Evidence | Cohort filter: Nov 14. Open Jordan’s practical row. | 10 rows. Jordan: submission present, recordings **MISSING**, event logs **SIMULATED**. The four other students show missing exam artefacts because they have not started. |
| 10:30 | Student sign-in | Use `amahle.dlamini@student.zaio.io`. Send OTP. | Banner says a code was sent — it is **not** shown on screen. Retrieve it with the curl command above (or ahead of time) and type it in. |
| 11:15 | My exams | Show Amahle’s two assignments. Optionally open Jordan in another browser only if you need the completed view. | Amahle: both **ASSIGNED**, buttons **Start (proctoring)**. Jordan, if shown: MCQ **100%** and practical **SUBMITTED**. |

If you start Amahle’s exam, the next screen says **Demo only** and that monitoring does not change marks. If the camera is refused, choose **Prepare session & recording**, then **Continue to exam**. The exam still opens. No recording file is created, and Evidence keeps that recording **MISSING**.

**If you continue into the practical workspace** (optional, not in the scripted 12 minutes — use a disposable test student per `MANUAL-RECORDING-TEST.md`, not Amahle, if you want to leave real student state untouched): point out the dark file explorer (`index.html`/`style.css`/`script.js`), the open-file tabs across the top, and the **Dark Mode / Light Mode** toggle in the top-right of the editor toolbar — click it to show the instant switch, no reload, no lost code. The live preview on the right is unaffected by the toggle either way; it always renders the student's own HTML/CSS/JS as a plain webpage.

## Known limitations

- Older `Cohort audit-…` rows remain in the database. They are not the Nov 14 demo. Filter them out.
- The Evidence “Recording” column uses short status words such as `none`, `setup`, or `real_capture_unavailable`. Those are not proof of a recording. Trust the **MISSING** and **SIMULATED** badges.
- Jordan’s practical can show recording status `setup` because a setup session was created and no file was uploaded. The ended session also has no file.
- Proctoring files, when a later test creates them, live under `server/data/recordings/` and are labelled simulated. This demo did not create one for the five seeded students.
- Scores do not decide a qualification outcome. Assessor approval is separate from the automated practical score.
- Admin requires signing in with the administrator account you bootstrapped (see Startup above). In this demo's mock delivery mode, a password-reset email is never actually retrievable (it's only captured in server memory, not sent or logged anywhere you can read) — keep that password written down safely before presenting rather than relying on **Forgot your password?** to recover it live.
- On a phone, use **Menu**. On a laptop, the left sidebar stays visible.
- If you demo real camera recording, Chrome will ask for screen-share permission **twice** on the proctoring setup page — once during "Run permission checks" (a quick test that's immediately released) and again when you click "Prepare session & recording" (this is the one that actually records). Pick a window/screen both times; the second pick is the one that matters.
- Keep any real webcam/screen recording demo short (a few minutes), not the full exam duration. Recordings are held in browser memory for the whole exam and only uploaded at final submit, with no bitrate cap — a long real recording risks exceeding the server's ~18–19MB per-file upload ceiling and being rejected at the very end. See `MANUAL-RECORDING-TEST.md` §9 for detail.
- The practical editor's Dark/Light preference is stored in that browser's `localStorage`, not on the student's account — it won't follow them to a different machine or browser, and switching machines for the demo means re-clicking the toggle (defaults to Dark Mode either way).
- The brand redesign and the IDE editor (dark/light themes, file explorer, tabs, resizable split) have all passed TypeScript/build/smoke checks, but no one has visually opened them in a real browser yet. Do a quick look-over yourself before presenting — see the final checklist in `DEMO-COMPLETION-REPORT.md`.

## Troubleshooting

| What you see | What to do |
|---|---|
| Blank admin pages or “Failed to load” | Confirm the terminal says the API is listening on port 3001. Restart with `npm run dev`. |
| `EADDRINUSE` on 3001 | Another API is already running. Use that one, or stop it and start again. Do not start a second copy. |
| Vite did not open 5173 | Use the `Local:` URL in the terminal. |
| “No student found” | Use the full `@student.zaio.io` address. Audit addresses are not this cohort. |
| OTP rejected | It is single-use and expires in 10 minutes. Send OTP again and retrieve the new code with the curl command above — it does not appear on screen. If the retrieval command itself 404s with "No mock OTP captured," confirm `OTP_DELIVERY_MODE=mock` in `server/.env` and restart the API; see `docs/LOCAL-OTP-TESTING.md` for the full command reference and rate-limit table. |
| Admin shows a sign-in screen you can't get past | Bootstrap the first administrator (see Startup above) if none exists yet, or double-check the email/password. Five wrong attempts locks that account for 15 minutes. |
| Nov 14 cohort missing | Run `npm run seed:demo` again. It will not wipe Jordan’s submission. |
| Student sees “Already submitted” | That is Jordan’s MCQ or practical. Use Amahle for a fresh start. |
| Camera or screen share fails | Continue anyway. Say that no recording was stored. Do not upload a stand-in file. |
| Assessor list has no Jordan | The list only includes submitted practicals. Jordan should be there with automated 100% and Pending. |
| Moderation looks empty | Choose **All** or **Pending**. Jordan is Pending until someone records a moderation decision. |
