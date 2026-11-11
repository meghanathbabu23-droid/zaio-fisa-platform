export const SESSION_COOKIE = "fisa_admin_session";
export const CSRF_COOKIE = "fisa_admin_csrf";
export const CSRF_HEADER = "x-csrf-token";

export const adminAuthConfig = {
  sessionTtlMs: 8 * 60 * 60 * 1000, // 8h, matching the student session TTL
  bcryptRounds: 12,
  maxFailedLoginAttempts: 5,
  lockoutMs: 15 * 60 * 1000, // 15 minutes
  passwordResetTtlMs: 30 * 60 * 1000, // 30 minutes
  minPasswordLength: 12,
  loginIpLimitWindowMs: 15 * 60 * 1000,
  // Overridable so the automated test suite — which drives many admin
  // logins from one loopback IP across dozens of unrelated test cases — can
  // raise this well above the 10/15min production default without weakening
  // it for real deployments. The per-ACCOUNT lockout (maxFailedLoginAttempts
  // above) is the actual brute-force defense exercised under its real,
  // production value in tests; this IP limiter is a secondary layer with
  // its own dedicated unit test.
  loginIpLimitMax: Number(process.env.ADMIN_LOGIN_IP_LIMIT_MAX) || 10,
};

export function isStrongPassword(password: string): { ok: true } | { ok: false; reason: string } {
  if (password.length < adminAuthConfig.minPasswordLength) {
    return { ok: false, reason: `Password must be at least ${adminAuthConfig.minPasswordLength} characters.` };
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password));
  if (classes.length < 3) {
    return {
      ok: false,
      reason: "Password must include at least 3 of: lowercase, uppercase, digit, symbol.",
    };
  }
  return { ok: true };
}
