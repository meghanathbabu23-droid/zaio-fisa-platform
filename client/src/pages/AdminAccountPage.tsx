import { useState } from "react";
import { changeAdminPassword } from "../api";
import { useAdminAuth } from "../admin/AdminAuthContext";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { StateBanner } from "../components/ui/StateBanner";

export function AdminAccountPage() {
  const { admin } = useAdminAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    setSaving(true);
    try {
      await changeAdminPassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Your account" description="Manage your own login — this never affects other administrators." />
      <div className="flex-1 p-8">
        <Card className="max-w-md">
          <p className="font-display text-lg font-semibold text-zaio-ink">{admin?.fullName}</p>
          <p className="text-sm text-zaio-ink/60">
            {admin?.email} · {admin?.role}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <p className="font-display text-base font-semibold text-zaio-ink">Change password</p>
            {error ? <StateBanner tone="error">{error}</StateBanner> : null}
            {success ? (
              <StateBanner tone="success">
                Password changed. Your other sessions have been signed out; this one stays signed in.
              </StateBanner>
            ) : null}
            <label className="block text-sm">
              Current password
              <input
                className="input mt-1"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </label>
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
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Change password"}
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
