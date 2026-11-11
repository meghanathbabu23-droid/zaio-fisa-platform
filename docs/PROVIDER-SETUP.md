# Email/SMS provider setup (Resend + Twilio) and real-delivery testing

This covers turning on real OTP delivery (and real admin password-reset
email) for student/admin accounts. Nothing here is switched on by default —
the Nov 14 demo cohort stays on mock delivery unless you deliberately enable
it per the gates below.

## The two independent gates

Real delivery for a given student requires **both**:

1. **Global delivery mode** — `OTP_DELIVERY_MODE=live` in `server/.env`
   (server-wide; the server refuses to boot in `live` mode if any required
   credential is missing or malformed — there is no silent fallback to mock).
2. **Per-cohort eligibility** — `Cohort.realOtpEligible = true`, toggled by a
   SUPER_ADMIN only, from the Cohorts page (or `PUT /api/cohorts/:id/otp-eligibility`).
   This is **off** for every existing cohort, including Nov 14, and nothing
   in this codebase turns it on automatically or in bulk.

Both must be true for a specific student to receive a real email/SMS. This
is deliberate: it means you can run the server in live mode (e.g. in a real
deployment) without every cohort immediately starting to text students.

Check current status (SUPER_ADMIN only, no secrets ever shown) via the
Administrators area's delivery-status view or directly:
`GET /api/admin/status/delivery`.

## Resend (email)

1. Create an account at resend.com and verify a sending domain.
2. Create an API key.
3. Set in `server/.env`:
   ```
   RESEND_API_KEY=re_...
   RESEND_FROM_EMAIL=noreply@your-verified-domain.com
   RESEND_FROM_NAME=Zaio FISA   # optional, defaults to "Zaio FISA"
   ```
`RESEND_FROM_EMAIL` must be on the domain you verified with Resend, or sends
will fail.

## Twilio (SMS)

1. Create a Twilio account and get an Account SID + Auth Token from the console.
2. Acquire a phone number capable of sending SMS to your target countries.
3. Set in `server/.env`:
   ```
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   TWILIO_PHONE_NUMBER=+1...        # E.164 format
   ```

**Do not assume a Twilio trial account can deliver to every destination.** A
trial account can only send to phone numbers you've explicitly verified in
the Twilio console, and some destination countries require a registered
sender ID or local number regardless of trial/paid status (this applies to
South Africa, FISA's primary cohort — check Twilio's current country-specific
requirements before relying on this for a real cohort). Upgrade to a paid
account and register a sender for your destination country before enabling
live SMS for real students.

## Switching the server to live mode

Set `OTP_DELIVERY_MODE=live` in `server/.env` with all five variables above
present and well-formed, then restart the server. It will refuse to start if
any are missing or malformed — check the startup error message, which names
the problem (never a secret value).

## Testing real delivery (manual, one-off, never automatic)

`server/scripts/test-live-delivery.ts` sends **exactly one** real test email
and/or SMS to recipient(s) **you specify on the command line** — never a
student, never a cohort, nothing read from the database. It's not referenced
by any test, build, or CI step; a human runs it deliberately:

```bash
cd server
npm run test:live-delivery -- --email you@yourdomain.com --sms +15551234567 --confirm
```

- `--confirm` is required — without it the script refuses, so a mistyped
  command alone can't send anything.
- Refuses unless `OTP_DELIVERY_MODE=live` and every credential above is
  present and well-formed.
- Writes nothing to the database — it calls the Resend/Twilio SDKs directly,
  bypassing the OTP/login system entirely.
- Prints only the provider's own message id / accepted-or-not status, never
  an OTP code and never any address beyond the one you typed.

A provider reporting "accepted" is **not** proof of actual delivery — open
the real inbox/phone and confirm the message arrived before concluding
real delivery works end to end. As of this writing, no one has run this
script with real credentials in this environment (none exist here), so real
delivery has not been confirmed — do not take any claim otherwise in this
repository's history as evidence it has been.

## Known limitations

- Delivery failures are recorded (`OtpDeliveryFailure` table, visible to
  SUPER_ADMIN) with a sanitized category only (e.g. `AUTH_ERROR`,
  `INVALID_RECIPIENT`, `RATE_LIMITED`) — never the provider's raw error
  message, which can contain the recipient address or account details.
- There's no provider failover (e.g. Resend down → no automatic fallback to
  another email provider) — a provider outage shows as delivery failures,
  not a silent switch to mock.
- SMS country-specific restrictions (sender registration, trial-account
  verified-number lists) are a Twilio account/console concern, not something
  this codebase can detect or work around automatically.
