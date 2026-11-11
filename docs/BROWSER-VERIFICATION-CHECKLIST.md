# Browser verification checklist — admin auth/RBAC + student login

**Status: not yet performed.** This checklist was prepared but not executed —
the Claude in Chrome browser extension was not connected in the environment
that wrote it, so none of the items below have been visually confirmed.
Run through this yourself (or ask Claude to, once the extension is
connected) before treating the admin auth/RBAC work as demo-ready.

## 0. Setup

```bash
cd server && npm run dev &     # API on :3001
cd client && npm run dev       # Vite on :5173 (or whatever port it prints)
```

You need a bootstrapped SUPER_ADMIN account first (see `docs/ADMIN-SETUP.md`).
Do not use any real student record for the "student login" section below —
create a disposable test student from the admin UI (or `npm run seed:demo`'s
output, which you can delete afterward) instead.

## 1. Admin login

| # | Step | Expected |
|---|---|---|
| 1.1 | Go to the admin URL while logged out | Sign-in form (email + password), no leftover "admin key" screen anywhere |
| 1.2 | Submit with empty fields | Inline "Enter your email and password" — no request sent (check devtools Network tab) |
| 1.3 | Submit a wrong password for a real account | Generic "Invalid email or password." — same wording as 1.4 |
| 1.4 | Submit a nonexistent email | Generic "Invalid email or password." — **identical text** to 1.3, so neither reveals which emails exist |
| 1.5 | Submit the wrong password **5 times** in a row for one account, then the correct one | After the 5th wrong attempt: "Account temporarily locked..." (distinct wording, not the generic one). The 6th attempt — even with the **correct** password — still shows the lockout message |
| 1.6 | Submit correct credentials | Redirects into the admin dashboard; devtools Application tab shows a `fisa_admin_session` cookie (HttpOnly — you can see it listed but not read its value from the Console) and a `fisa_admin_csrf` cookie (readable) |
| 1.7 | Refresh the page after logging in | Stays logged in (session persists via the cookie) — no re-login prompt |
| 1.8 | Click **Sign out** | Returns to the sign-in form; refreshing afterward does NOT log you back in |
| 1.9 | Open devtools → Application → Local/Session Storage while logged in | Confirm neither contains a password, session token, or anything admin-auth-related — the old shared-key model stored a key in `sessionStorage`; this should be gone entirely |

## 2. Session expiry / invalidation

| # | Step | Expected |
|---|---|---|
| 2.1 | Log in, then (as the same or another SUPER_ADMIN) use **Administrators → Revoke sessions** on your own account | You're logged out on next action/refresh — this proves the 401→login-screen fallback works without you manually clearing anything |
| 2.2 | Log in from two different browsers/profiles as the same admin, then use **Change password** in one | The browser where you changed it stays logged in; the other is logged out on its next request |

## 3. Role-based navigation and access (needs disposable accounts)

As your bootstrapped SUPER_ADMIN, go to **Administrators** and create one
disposable account per role below (throwaway emails/passwords — delete them
when done, or leave them since they're not real student/demo data). Log in
as each and check:

| Role | Nav items that SHOULD appear | Nav items that should NOT appear | Direct-URL check |
|---|---|---|---|
| **ADMIN** | Dashboard, Cohorts, Students, Exams, Assignments, Results, Proctoring, Evidence | Assessor, Moderation, Administrators | Visiting `/assessor/practical` or `/admin/users` directly shows the **Unauthorized** page, not the real content |
| **ASSESSOR** | Assessor only (no Dashboard — role home redirects straight to Assessor) | Everything else | Visiting `/cohorts` or `/moderation` directly shows **Unauthorized** |
| **MODERATOR** | Moderation only (role home redirects straight to Moderation) | Everything else | Visiting `/students` or `/assessor/practical` directly shows **Unauthorized** |
| **SUPER_ADMIN** | Everything, including Administrators | — | — |

For at least one blocked case, open devtools → Network while on the
Unauthorized page and confirm the underlying API call (if the page made
one) returned **403**, not 200 — the UI hiding the link is a convenience,
the 403 is the real boundary.

Additional checks on the **Administrators** page as SUPER_ADMIN:

| # | Step | Expected |
|---|---|---|
| 3.1 | Try to change your OWN role in the edit form | Rejected with "You cannot change your own role..." |
| 3.2 | Try to deactivate your OWN account | Rejected with "You cannot deactivate your own account." |
| 3.3 | Try to delete your OWN account | Delete button is disabled for your own row, labeled "You cannot delete your own account" |
| 3.4 | Edit another admin's role/active status | Succeeds |
| 3.5 | Delete another (disposable) admin | Succeeds; they disappear from the list |
| 3.6 | Click **Revoke sessions** for another logged-in admin | Confirms a revoked count; that admin is logged out on their next request |

## 4. Password change (as any logged-in admin)

| # | Step | Expected |
|---|---|---|
| 4.1 | Go to **Your account**, submit the wrong current password | Rejected, no change |
| 4.2 | Submit a weak new password (e.g. `short`) | Rejected with the strength requirement message |
| 4.3 | Submit a valid new password | Succeeds; a success banner appears |
| 4.4 | Log out and log back in with the OLD password | Fails |
| 4.5 | Log in with the NEW password | Succeeds |

## 5. Password reset (known gap — cannot be fully tested locally)

In the default `OTP_DELIVERY_MODE=mock` setup, **Forgot your password?**
always returns the same generic "if registered..." message (confirm this),
but the actual reset email is only captured in server memory — there is no
way to retrieve the real reset link from the UI or an API call in mock mode.
Confirm the generic-response behavior, but don't expect to be able to walk
the full reset-to-login flow end to end until real Resend delivery is
configured (`docs/PROVIDER-SETUP.md`).

## 6. Student login — unaffected by any of the above

Use a disposable test student, not a real Nov 14 demo student.

| # | Step | Expected |
|---|---|---|
| 6.1 | Go to `/student/login`, enter the test student's email, request a code | Mock-delivery banner shows the demo code on screen (unchanged behavior) |
| 6.2 | Enter the code | Logs in, lands on "My exams" |
| 6.3 | Confirm no admin-related cookie/storage appears on this page | Student session uses a separate Bearer-token mechanism, not the admin cookie |

## Sign-off

Once every row above has actually been clicked through (not just read), replace the
"Status" line at the top with the date and who ran it. Don't mark this done based on
this document alone — it's a script, not evidence.
