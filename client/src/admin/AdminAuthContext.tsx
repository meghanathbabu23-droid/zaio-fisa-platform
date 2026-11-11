import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchAdminMe, logoutAdmin } from "../api";
import { ADMIN_UNAUTHORIZED_EVENT } from "./session";
import type { AdminIdentity } from "../types";

type AdminAuthState = {
  admin: AdminIdentity | null;
  /** True only while the very first /api/admin/me check is in flight. */
  loading: boolean;
  /** Re-checks the session (e.g. right after a successful login). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AdminAuthContext = createContext<AdminAuthState | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await fetchAdminMe();
      setAdmin(me);
    } catch {
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // adminFetch dispatches this on any 401 from a real API call (expired or
  // revoked session) — falls back to the login screen without this
  // component having to poll the server itself.
  useEffect(() => {
    function onUnauthorized() {
      setAdmin(null);
      setLoading(false);
    }
    window.addEventListener(ADMIN_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(ADMIN_UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutAdmin();
    } catch {
      // Already logged out server-side (e.g. session expired moments ago) —
      // either way, the local state below is what actually gates the UI.
    }
    setAdmin(null);
  }, []);

  return (
    <AdminAuthContext.Provider value={{ admin, loading, refresh, logout }}>{children}</AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthState {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within an AdminAuthProvider");
  return ctx;
}
