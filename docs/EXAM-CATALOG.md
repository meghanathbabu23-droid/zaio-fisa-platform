# Exam catalog — two canonical FISA assessments

As of this pass, the platform has exactly **two active exam types** offered
in the admin exam-assignment picker:

1. **FISA Knowledge Assessment — HTML, CSS & Bootstrap (SP-230372)** — MCQ,
   45 minutes, 20 scenario-based questions (HTML5 semantics, accessible
   forms/tables, CSS selectors/box model/Flexbox/Grid, responsive design,
   Bootstrap 5), 60% pass mark, auto-marked.
2. **FISA Practical Assessment — HTML, CSS & Bootstrap (SP-230372)** —
   Practical coding, 120 minutes, 30 automated test cases across three
   challenges (semantic HTML forms/tables, responsive CSS Flexbox/Grid,
   responsive Bootstrap 5 site), 60% pass mark, auto-assessed + assessor
   review.

Both are seeded/kept up to date by `npm run seed:fisa`
(`server/scripts/seed-fisa-assessment.ts`) — idempotent, safe to re-run; it
finds-or-creates by exact title and never touches the Nov 14 demo cohort,
its exams, or any other exam.

## How "active" works

`Exam.isActive` (boolean, default `true`) controls whether an exam appears
in the **exam-assignment picker** (Assignments page) when creating a new
assignment. It does **not** affect:
- Students who already have the exam assigned — they keep full access.
- Existing submissions, scores, evidence, or results tied to it.
- The Exams page's full list, which has an **Active / Archived** toggle so
  nothing is actually hidden from an admin, only from the *new-assignment*
  flow.

Toggle it per-exam from the Exams page (**Archive** / **Restore** button,
SUPER_ADMIN only), or via `PUT /api/exams/:id/active`.

## Legacy cleanup (this pass)

`server/scripts/deactivate-legacy-exams.ts` (idempotent; `--dry-run` to
preview) set `isActive=false` on every exam that is **not** one of the two
canonical FISA exams above and **not** one of the Nov 14 demo cohort's two
exams — 23 exams at the time this was run (various `audit-*`/`QA *`/`Race
MCQ`/duplicate `HTML MCQ`/`HTML Practical` rows left over from earlier
testing passes). **No row was deleted.** Run it again any time a fresh
round of ad hoc testing leaves new exams behind:
```bash
cd server
npm run deactivate-legacy-exams -- --dry-run   # preview
npm run deactivate-legacy-exams                # apply
```
It always keeps the two canonical FISA exams and anything with
`(Nov 14 Demo)` in its title active, regardless of how many times it runs.

## Student-facing "Run Tests"

The practical exam workspace has a **Run Tests** button (alongside **Submit
final**) that runs the exam's test cases against the student's current,
already-autosaved files and shows a pass/fail breakdown in the left panel —
without creating a submission or affecting the final score. Backed by
`POST /api/student/assignments/:id/practical/run-tests`
(`server/src/routes/practical.ts`), which reuses the exact same
`runPracticalTests` pure function the real auto-assessment pipeline uses —
there is only one test-execution implementation, not two.
