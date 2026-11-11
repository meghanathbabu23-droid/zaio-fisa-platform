import { Outlet } from "react-router-dom";
import { AdminAuthProvider, useAdminAuth } from "../admin/AdminAuthContext";
import { AdminLoginPage } from "./AdminLoginPage";
import { Logo } from "./ui/Logo";

function AdminAuthLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zaio-paper">
      <Logo />
      <p className="text-sm text-zaio-ink/60">Checking session…</p>
    </div>
  );
}

function AdminGate() {
  const { admin, loading, refresh } = useAdminAuth();

  if (loading) {
    return <AdminAuthLoading />;
  }
  if (!admin) {
    return <AdminLoginPage onLoggedIn={refresh} />;
  }
  return <Outlet />;
}

/**
 * Gates the entire admin route tree behind a real login screen. On mount
 * (and whenever adminFetch sees a 401), AdminAuthProvider checks
 * GET /api/admin/me against the httpOnly session cookie — there's nothing
 * client-stored to check synchronously, unlike the old shared-key model.
 */
export function AdminRoute() {
  return (
    <AdminAuthProvider>
      <AdminGate />
    </AdminAuthProvider>
  );
}
