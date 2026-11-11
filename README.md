# Zaio FISA Platform

A custom examination and assessment platform for Zaio's HTML Programmer Skills Programme (SP-230372).

## Project Status

Phase 1 demo: admin dashboard and cohort CRUD, now with individual admin accounts/RBAC and real (optional) email/SMS OTP delivery.

## Technology Stack

- **Client:** React, Vite, TypeScript, Tailwind CSS
- **Server:** Express, Node.js, Prisma, SQLite

## Quick start

```bash
cp -n .env.example server/.env
npm install
npm run db:push
npm run dev
```

- Admin UI: http://localhost:5173 by default. If that port is already in use, Vite prints the port it opened.
- API: http://localhost:3001

Admin access requires an individual account — there is no shared key or
default login. If no administrator exists yet, create the first one once:

```bash
cd server
npm run bootstrap-admin -- --email you@yourdomain.com --name "Your Name"
```

You'll be prompted for the password interactively (hidden, with confirmation) — it's never a command-line argument.

See `docs/ADMIN-SETUP.md` for roles/permissions and the full workflow, and
`docs/PROVIDER-SETUP.md` for enabling real email/SMS OTP delivery via
Resend/Twilio (off by default — student/admin sign-in uses mock/simulated
codes until you explicitly configure and enable it).

**Testing student login locally:** in mock mode, the OTP code is never shown
on screen or returned by the API — retrieve it with the dev-only endpoint
documented in `docs/LOCAL-OTP-TESTING.md`.

**Testing with your own email/phone (internal testing phase only):** see
`docs/OPEN-TEST-REGISTRATION.md` for the temporary, heavily-gated tester
self-registration flow (`ENABLE_OPEN_TEST_REGISTRATION=true`).
