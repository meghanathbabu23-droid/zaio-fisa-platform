# Retrieving the OTP code during local/dev testing (mock delivery mode)

## Why you're not receiving a real email or SMS

By design. `OTP_DELIVERY_MODE=mock` (the default — check `server/.env`) means
the server **never calls Resend or Twilio at all**. It still generates a real
code and stores its hash, exactly as it would in live mode, but the "send"
step is a mock provider that just remembers the code in server memory
instead of calling a real API. This is intentional for local development and
the Nov 14 demo cohort — see `docs/PROVIDER-SETUP.md` for what's needed to
switch a cohort to real delivery.

**If you were expecting a code to appear directly on the sign-in page: that
used to be true, and no longer is.** An earlier security hardening pass
removed the OTP code from the `/api/auth/otp/request` response and the
sign-in page's banner, specifically so a leftover `demoOtp`-style field could
never accidentally ship in a production response. `DEMO-RUNBOOK.md`
previously still described a "yellow banner" with the code visible on screen
— that was stale documentation, not current behavior, and has been corrected
(see §6 below). The only way to retrieve a mock-mode code now is the
endpoint documented here.

## The exact retrieval mechanism

`GET /api/test/last-otp?channel=<EMAIL|SMS>&value=<identifier>`

- Only mounted at all when `OTP_DELIVERY_MODE=mock` (checked at server
  startup in `server/src/app.ts`).
- Returns `404` if `NODE_ENV=production` (checked again inside the handler
  itself, in `server/src/routes/testOtp.ts` — a second, independent guard,
  not just reliance on the fact that mock+production can't boot together in
  the first place).
- `channel` must be exactly `EMAIL` or `SMS` (case-insensitive).
- `value` must be the **exact** identifier you requested a code for — the
  email address as typed (normalized to lowercase, matching what
  `/otp/request` does), or the phone number in **E.164** format (e.g.
  `+27821110001`), since that's the normalized form the server actually
  stores and looks up against.
- Returns `404` with `{"error": "No mock OTP captured for that identifier"}`
  if nothing has been requested for that exact identifier yet, or if a more
  recent request for a *different* identifier overwrote nothing relevant (it
  only tracks the single most recent code per identifier).
- On success: `{"code": "123456", "expiresAt": "2026-...Z"}`.

### Exact commands

```bash
# 1. Request a code (this is the normal student-facing endpoint)
curl -s -X POST http://localhost:3001/api/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"email":"your.test.student@example.com"}'

# 2. Retrieve the code the mock provider "sent" for that identifier
curl -s "http://localhost:3001/api/test/last-otp?channel=EMAIL&value=your.test.student@example.com"

# 3. Verify it (this is the normal student-facing endpoint)
curl -s -X POST http://localhost:3001/api/auth/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"your.test.student@example.com","code":"<code from step 2>"}'
```

For a phone/SMS identifier, swap `email`/`EMAIL` for `phone`/`SMS` and use an
E.164 number:

```bash
curl -s -X POST http://localhost:3001/api/auth/otp/request \
  -H "Content-Type: application/json" -d '{"phone":"+27821119000"}'
curl -s "http://localhost:3001/api/test/last-otp?channel=SMS&value=%2B27821119000"
```
(`%2B` is a URL-encoded `+` — without it, some HTTP clients will mangle the
leading `+` in a query string.)

## Rate limits that can make this *look* like delivery is broken

These are correct, intentional behavior, not bugs — but they can look like
"nothing is happening" if you test repeatedly in a short window, because the
error that explains it is easy to miss on-screen:

| Limit | Scope | Window | What you'll see |
|---|---|---|---|
| Per-IP request limit | Your machine's IP, all identifiers combined | 5 requests / hour (production default; higher in the automated test environment only) | `429 {"error":"Too many requests. Please wait and try again."}` from `/otp/request` |
| Per-identifier request limit | One email/phone | 3 requests / 10 min | Same 429, same message |
| Resend cooldown | One email/phone | 60 seconds since its last request | Same 429, same message |
| Per-IP verify limit | Your machine's IP | 10 attempts / 10 min | Same 429 from `/otp/verify` |
| Per-student verify-failure limit | One student | 10 failures / 10 min | Generic `401 {"error":"Invalid code..."}`, not 429 — indistinguishable from a wrong code by design |
| Per-token attempt limit | One specific OTP code | 5 wrong guesses | Same generic 401 as above |

All of these return the identical generic error text whether the account
exists or not (enumeration-safe by design) — read the actual response body,
not just "did something visually change," when testing. If you hit the
per-IP hourly limit while doing repeated manual testing, the fix is to wait
(or use a fresh test identifier won't help — it's per-IP, not per-identifier).

## Verified end-to-end (this pass)

Live-tested against a disposable test cohort/student (created and deleted
during this check, never a real Nov 14 student) on the running dev server:
request → retrieve via the endpoint above → verify → session token issued →
authenticated call to `/api/student/assignments` succeeded. A wrong code and
a reused (already-consumed) code were both correctly rejected. Expiry,
reuse, and the 5-wrong-attempts lockout are additionally covered by the
automated test suite (`server/test/otp.test.ts`), which passes.
