/**
 * Cookie-based admin session support. Unlike the old shared-key model,
 * nothing sensitive is stored by this module — the actual session lives in
 * an httpOnly cookie the browser handles automatically, invisible to this
 * JS. The only thing read here is the separate, deliberately non-httpOnly
 * CSRF cookie the server sets alongside it (the double-submit pattern):
 * its value must be echoed back as the X-CSRF-Token header on every
 * mutating admin request.
 */
export function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)fisa_admin_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export const ADMIN_UNAUTHORIZED_EVENT = "zaio-admin-unauthorized";

/** Called by adminFetch on any 401 — notifies AdminRoute to fall back to
 * the login screen. There's nothing to "clear" locally; the server already
 * considers the session gone (expired/revoked/never existed). */
export function notifyAdminUnauthorized(): void {
  window.dispatchEvent(new Event(ADMIN_UNAUTHORIZED_EVENT));
}
