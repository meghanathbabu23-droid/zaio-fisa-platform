import { useCallback, useEffect, useState } from "react";
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminUsers,
  revokeAdminUserSessions,
  updateAdminUser,
} from "../api";
import { useAdminAuth } from "../admin/AdminAuthContext";
import { AdminUserFormModal } from "../components/AdminUserFormModal";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { StateBanner } from "../components/ui/StateBanner";
import type { AdminUserRow } from "../types";
import { formatDate } from "../lib/dates";

export function AdminUsersPage() {
  const { admin: me } = useAdminAuth();
  const [admins, setAdmins] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchAdminUsers()
      .then(setAdmins)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load administrators"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(data: Parameters<typeof createAdminUser>[0] | Parameters<typeof updateAdminUser>[1]) {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateAdminUser(editing.id, data as Parameters<typeof updateAdminUser>[1]);
      } else {
        await createAdminUser(data as Parameters<typeof createAdminUser>[0]);
      }
      setModalOpen(false);
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: AdminUserRow) {
    if (!window.confirm(`Delete administrator "${row.fullName}" (${row.email})? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteAdminUser(row.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleRevoke(row: AdminUserRow) {
    setError(null);
    setNotice(null);
    try {
      const result = await revokeAdminUserSessions(row.id);
      setNotice(`Revoked ${result.revoked} active session(s) for ${row.fullName}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke sessions");
    }
  }

  return (
    <>
      <PageHeader
        title="Administrators"
        description="Individual admin accounts and roles — SUPER_ADMIN only."
        action={
          <Button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            New administrator
          </Button>
        }
      />
      <div className="flex-1 p-8">
        {error ? (
          <StateBanner tone="error" className="mb-4">
            {error}
          </StateBanner>
        ) : null}
        {notice ? (
          <StateBanner tone="success" className="mb-4">
            {notice}
          </StateBanner>
        ) : null}
        <div className="overflow-hidden rounded-2xl border border-zaio-cloud bg-zaio-card shadow-sm">
          {loading ? (
            <p className="px-6 py-10 text-sm text-zaio-ink/50">Loading…</p>
          ) : admins.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zaio-ink/60">No administrators yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead className="border-b border-zaio-cloud bg-zaio-paper/80 text-xs font-medium uppercase tracking-wide text-zaio-ink/50">
                  <tr>
                    <th className="px-6 py-3">Name</th>
                    <th className="px-6 py-3">Email</th>
                    <th className="px-6 py-3">Role</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Last login</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zaio-cloud">
                  {admins.map((row) => {
                    const isSelf = row.id === me?.id;
                    const isLocked = row.lockedUntil && new Date(row.lockedUntil) > new Date();
                    return (
                      <tr key={row.id} className="hover:bg-zaio-paper/50 transition-colors">
                        <td className="px-6 py-4 font-medium text-zaio-ink">
                          {row.fullName} {isSelf ? <span className="text-xs text-zaio-ink/50">(you)</span> : null}
                        </td>
                        <td className="px-6 py-4 text-zaio-ink/70">{row.email}</td>
                        <td className="px-6 py-4">
                          <Badge tone="brand">{row.role}</Badge>
                        </td>
                        <td className="px-6 py-4">
                          {!row.active ? (
                            <Badge tone="neutral">Inactive</Badge>
                          ) : isLocked ? (
                            <Badge tone="warning">Locked</Badge>
                          ) : (
                            <Badge tone="success">Active</Badge>
                          )}
                        </td>
                        <td className="px-6 py-4 text-zaio-ink/70">
                          {row.lastLoginAt ? formatDate(row.lastLoginAt) : "Never"}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            type="button"
                            className="mr-3 text-zaio-blue"
                            onClick={() => {
                              setEditing(row);
                              setModalOpen(true);
                            }}
                          >
                            Edit
                          </button>
                          <button type="button" className="mr-3 text-zaio-blue" onClick={() => handleRevoke(row)}>
                            Revoke sessions
                          </button>
                          <button
                            type="button"
                            className="text-red-600 disabled:cursor-not-allowed disabled:text-zaio-ink/30"
                            disabled={isSelf}
                            title={isSelf ? "You cannot delete your own account" : undefined}
                            onClick={() => handleDelete(row)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {modalOpen ? (
        <AdminUserFormModal
          editing={editing}
          saving={saving}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      ) : null}
    </>
  );
}
