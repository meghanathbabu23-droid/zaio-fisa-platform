# Temporary open tester self-registration

A temporary feature for the current internal testing phase: lets anyone
(you, your senior, other team members) create a real, OTP-login-capable
student record for themselves — using their own email and mobile number —
without an admin having to create each account by hand first. It reuses the
existing student model, OTP flow, and cohort/assignment rules completely;
nothing about real student authentication was changed.

## Enabling it

Three conditions must **all** be true, or the feature is completely
disabled (the registration endpoint 404s, as if it didn't exist):

1. `NODE_ENV` is not `"production"`
2. `OTP_DELIVERY_MODE=mock`
3. `ENABLE_OPEN_TEST_REGISTRATION=true`

Set in `server/.env`:
```
ENABLE_OPEN_TEST_REGISTRATION=true
```
Then **restart the API server** — like all env vars here, this is read once
at process start, so editing `.env` alone doesn't take effect for an
already-running `tsx watch` process.

The server also refuses to **start at all** if `ENABLE_OPEN_TEST_REGISTRATION=true`
while `NODE_ENV=production` — a loud failure, not a silently-ignored flag.

When you're done with this testing phase, remove or set this to `false` and
restart — there is no other cleanup required for the setting itself (the
test student records it created are regular `Student` rows; see "Cleaning
up" below if you want to remove them).

## Registering as a tester

Through the UI: go to the student sign-in page → **New tester? Register
here** → fill in full name, email, and mobile number → **Register**. You're
returned to the sign-in form with your email pre-filled; request your code
as normal.

Or directly:
```bash
curl -s -X POST http://localhost:3001/api/auth/register-tester \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Your Name","email":"you@example.com","phone":"+15551234567"}'
```
- `fullName`: split on whitespace into first/last name (a single word gets
  `lastName` filled in as `"Tester"`).
- `email`: validated for shape; must be unique or match your own existing
  registration.
- `phone`: validated and normalized to E.164 with the **same
  `libphonenumber-js`-based library** admin student creation uses
  (`server/src/lib/phone.ts`) — locally-formatted South African numbers
  (e.g. `082 111 0001`) are accepted and normalized automatically.

Registering again with the **exact same** email and phone reuses your
existing record (`"reused": true` in the response) — it never creates a
duplicate and never modifies the existing row. Registering with an email
that matches one existing record but a phone that matches a *different* one
(or doesn't match that same record) is rejected with `409` — this is
deliberately not resolved automatically, since there's no safe guess between
"typo" and "two different people."

Then log in exactly like any student — nothing about the OTP flow changed:
```bash
curl -s -X POST http://localhost:3001/api/auth/otp/request \
  -H "Content-Type: application/json" -d '{"email":"you@example.com"}'

curl -s "http://localhost:3001/api/test/last-otp?channel=EMAIL&value=you@example.com"
# {"code": "123456", ...} — see docs/LOCAL-OTP-TESTING.md for the full reference

curl -s -X POST http://localhost:3001/api/auth/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","code":"123456"}'
# {"token": "...", ...}
```
The same expiry (10 min), resend cooldown (60s), rate limits, and 5-wrong-
attempt lockout apply exactly as for a real student — none of that was
touched or weakened.

## What a tester can and can't see

A newly-registered tester lands in the student dashboard with their profile
and an **empty** exam list — they are placed in a dedicated cohort named
**"Internal Test Registrations (auto-created)"** (auto-created the first
time anyone registers), which has no exams assigned by default. They cannot
see or access any real student's examination, the Nov 14 cohort's exams, or
anyone else's assignments — the existing assignment-scoping rules
(`where: { studentId: req.studentId }` throughout `studentPortal.ts`) apply
identically to a test registration as to a real student, unchanged.

**To give a tester something to actually attempt**, a SUPER_ADMIN or ADMIN
creates an exam (or reuses an existing one) and assigns it to a tester from
the normal **Exams** / **Assignments** admin pages, exactly as for a real
student — the "Internal Test Registrations" cohort is a completely ordinary
cohort from the admin UI's point of view, so no new assignment mechanism was
built; the existing one is reused as-is.

## Admin visibility

On the **Students** page, every open-registered tester shows a
**"Internal test registration"** badge in a dedicated Registration column —
visible to both ADMIN and SUPER_ADMIN (the same roles who can already see
the Students page at all), so it's obvious at a glance which rows are real
students and which are internal test accounts. No password, OTP, or
authentication secret is ever exposed anywhere — testers have none (OTP
login has no passwords at all) and the admin student list never included
any such field even before this change.

## Cleaning up test accounts

There's no bulk-delete tool built for this (reuses the existing per-student
delete action) — on the Students page, delete a test-registration row the
same way you'd delete any student. Deleting the whole "Internal Test
Registrations" cohort (via Cohorts → delete) removes every tester registered
under it in one step, since `Student.cohortId` cascades on cohort deletion —
only do this once you're sure no one still needs their test account.

## Known limitations

- No rate limit on the registration endpoint itself beyond request-body
  validation — the existing OTP-side rate limits (per-identifier,
  per-IP, resend cooldown) still apply once someone tries to actually log
  in, but nothing stops many rapid registration POSTs. Acceptable for a
  short internal testing window on a non-public server; would need its own
  limiter before ever being exposed more broadly (which it should never be).
- Conflicting email/phone pairs are rejected outright (409) rather than
  offered any kind of "did you mean" resolution — by design, per "do not
  modify existing student records."
