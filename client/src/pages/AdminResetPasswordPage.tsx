import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { confirmAdminPasswordReset } from "../api";
import { AuthShell } from "../components/ui/AuthShell";
import { Button } from "../components/ui/Button";
import { StateBanner } from "../components/ui/StateBanner";

export function AdminResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      await confirmAdminPasswordReset(token, newPassword);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <p className="font-display text-xl font-semibold text-zaio-ink">Set a new password</p>
      {!token ? (
        <StateBanner tone="error" className="mt-4">
          This link is missing its reset token. Request a new one.
        </StateBanner>
      ) : done ? (
        <>
          <StateBanner tone="success" className="mt-4">
            Password changed. All previous sessions were signed out.
          </StateBanner>
          <Link to="/" className="mt-6 block text-center text-sm font-medium text-zaio-blue hover:underline">
            Go to sign in
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          {error ? <StateBanner tone="error">{error}</StateBanner> : null}
          <label className="block text-sm">
            New password
            <input
              className="input mt-1"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 12 characters, 3 of: lower/upper/digit/symbol"
            />
          </label>
          <label className="block text-sm">
            Confirm new password
            <input
              className="input mt-1"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={loading} fullWidth>
            {loading ? "Saving…" : "Set new password"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
