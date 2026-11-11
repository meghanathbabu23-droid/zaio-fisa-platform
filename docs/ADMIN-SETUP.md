# Administrator accounts, roles, and bootstrap

This replaces the earlier interim shared `ADMIN_API_KEY`. There is no default
administrator account, no hardcoded or universal password, and no public
endpoint that lets anyone create an administrator — the only way to create
the *first* account is the CLI script below, run by a human with shell
access to the server.

## Creating the first administrator (bootstrap)

From `server/`, with `DATABASE_URL` pointing at the database you want to use:

```bash
npm run bootstrap-admin -- --email you@yourdomain.com --name "Your Name"
```

You'll then be prompted for the password interactively — twice, to confirm
— rather than typing it as a CLI argument. At a real terminal, nothing is
echoed back (no characters, not even asterisks, the same as `sudo`), so it
never ends up in shell history or visible to another process via `ps`/`/proc`
while the command runs. Both `--email` and `--name` are required and nothing
is invented or defaulted. The password must be at least 12 characters and
include at least 3 of: lowercase, uppercase, digit, symbol.
- The script refuses to run if **any** administrator already exists in that
  database (`prisma.administrator.count() > 0`). This is intentional — it's a
  one-time bootstrap, not a general "create admin" tool. To add more admins
  afterwards, sign in as the SUPER_ADMIN you just created and use the
  **Administrators** page in the admin UI (or `POST /api/admin/users`).
- The password itself is never stored or logged anywhere — only its bcrypt
  hash, in the `Administrator.passwordHash` column.

## Signing in

Go to the admin URL (e.g. `http://localhost:5173`) and sign in with that
email and password. Sessions are cookie-based (httpOnly, `SameSite=Lax`,
`Secure` in production) — nothing admin-related is stored in
`localStorage`/`sessionStorage`. A session lasts 8 hours or until you sign
out, change your password (which revokes every *other* session for that
account), or a SUPER_ADMIN revokes it from the Administrators page.

Five wrong password attempts locks that account for 15 minutes
(`423 Account temporarily locked`). A nonexistent email and a wrong password
for a real account return the identical generic error, so a failed login
alone can't be used to discover which admin emails exist.

## Roles

| Role | Can do | Cannot do |
|---|---|---|
| **SUPER_ADMIN** | Everything below, plus: manage administrator accounts and roles, manage OTP delivery eligibility/configuration | — |
| **ADMIN** | Manage students and cohorts, manage exam *assignments*, view exams (read-only — cannot create/edit/delete exams or practical test cases), view results and evidence | Manage administrator accounts, change system-level security configuration (OTP eligibility, CORS, etc.) |
| **ASSESSOR** | View assigned practical submissions, review them, award marks/feedback | Modify student accounts, cohorts, or any system setting |
| **MODERATOR** | View the moderation queue, record moderation decisions | Change an assessor's original mark, modify any system setting |

Every one of these is enforced on the server (`server/src/middleware/requireRole.ts`
plus per-route checks in `server/src/app.ts` and some individual route files
that tighten further, e.g. only SUPER_ADMIN can write to `/api/exams`). The
admin UI also hides pages a role can't use, but that's a convenience, not the
real boundary — a direct API call from a disallowed role gets a `403`
regardless of what the UI shows.

## Password reset

**Forgot your password?** on the sign-in screen sends a reset link (valid 30
minutes, single-use) to the account's email via whichever email provider is
configured — see `PROVIDER-SETUP.md`. In the default `OTP_DELIVERY_MODE=mock`
development/demo setup, that email is never actually delivered anywhere
retrievable (it's only captured in server memory for tests); real delivery
requires switching to `OTP_DELIVERY_MODE=live` with Resend configured, same as
student OTP email. Confirming a reset revokes every existing session for that
account.

## Audit trail

Every sensitive action is recorded in `AdminAuditLog`: admin login/logout,
student/cohort/exam changes, OTP eligibility changes, assessor reviews,
moderation decisions, evidence access/download, administrator account
changes, and session revocation — each row records the acting admin, the
action, the target, and a timestamp. Passwords, OTP codes, API keys, and
session tokens are never written into an audit row (enforced by convention in
`server/src/lib/auditLog.ts` — the only place that writes this table). There
is currently no admin UI to browse this table; query it directly via Prisma
Studio (`npx prisma studio` from `server/`) if you need to inspect it.

## Known limitations

- No UI yet to browse the audit log (see above) — direct DB access only.
- Password reset email delivery is subject to the same mock/live gating as
  student OTP delivery (see `PROVIDER-SETUP.md`); it does not work end-to-end
  until real credentials are configured.
- There's no "break glass" recovery if every SUPER_ADMIN account is locked or
  deleted and you can't reach the database directly — recovery in that case
  means editing the `Administrator` table directly (e.g. via Prisma Studio)
  to reactivate/unlock an account, since the bootstrap script refuses to run
  once any administrator exists.
