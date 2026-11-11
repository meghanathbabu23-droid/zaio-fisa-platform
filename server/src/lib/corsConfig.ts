/**
 * Replaces the previous fully-open `cors()` with an explicit allow-list.
 * Note on what this does and doesn't protect: CORS is enforced by browsers,
 * not by this server — it stops a malicious website's JavaScript from
 * reading responses from a victim's browser, but does nothing against a
 * direct request from curl/Postman/a script (those never send an Origin
 * header, and CORS doesn't apply to them at all). The actual access control
 * for the admin API is requireAdminAuth plus requireRole; this is
 * defense-in-depth on top of it, not a replacement for it.
 */

const DEFAULT_DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS;
  if (raw && raw.trim()) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return process.env.NODE_ENV === "production" ? [] : DEFAULT_DEV_ORIGINS;
}

export const corsConfig = {
  allowedOrigins: parseAllowedOrigins(),
};

export function assertCorsConfigSafeToBoot(): void {
  if (process.env.NODE_ENV === "production" && corsConfig.allowedOrigins.length === 0) {
    throw new Error(
      "Refusing to start: ALLOWED_ORIGINS is empty in production — no browser origin would be permitted. " +
        "Set it to a comma-separated list of your real admin-dashboard origin(s)."
    );
  }
}
