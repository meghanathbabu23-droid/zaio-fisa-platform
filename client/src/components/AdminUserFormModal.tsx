import { useState } from "react";
import type { AdminRole, AdminUserInput, AdminUserRow } from "../types";
import { ModalShell } from "./ui/Modal/ModalShell";
import { Field } from "./ui/Modal/Field";
import { ModalActions } from "./ui/Modal/ModalActions";
import { StateBanner } from "./ui/StateBanner";

const ROLES: AdminRole[] = ["SUPER_ADMIN", "ADMIN", "ASSESSOR", "MODERATOR"];

/** Create mode (no `editing`) collects fullName/email/password/role.
 * Edit mode (`editing` set) only allows changing fullName/role/active — the
 * server has no "set someone else's password" endpoint on purpose. */
export function AdminUserFormModal({
  editing,
  saving,
  onClose,
  onSave,
}: {
  editing: AdminUserRow | null;
  saving: boolean;
  onClose: () => void;
  onSave: (data: AdminUserInput | { fullName: string; role: AdminRole; active: boolean }) => void;
}) {
  const [fullName, setFullName] = useState(editing?.fullName ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>(editing?.role ?? "ADMIN");
  const [active, setActive] = useState(editing?.active ?? true);
  const [validation, setValidation] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      setValidation("Full name is required.");
      return;
    }
    if (editing) {
      setValidation(null);
      onSave({ fullName: fullName.trim(), role, active });
      return;
    }
    if (!email.trim() || !password) {
      setValidation("Email and password are required.");
      return;
    }
    setValidation(null);
    onSave({ fullName: fullName.trim(), email: email.trim(), password, role });
  }

  return (
    <ModalShell title={editing ? "Edit administrator" : "New administrator"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {validation ? <StateBanner tone="info">{validation}</StateBanner> : null}
        <Field label="Full name">
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        {editing ? (
          <p className="text-sm text-zaio-ink/60">{editing.email}</p>
        ) : (
          <>
            <Field label="Email">
              <input
                className="input"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Temporary password">
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters, 3 of: lower/upper/digit/symbol"
              />
            </Field>
          </>
        )}
        <Field label="Role">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        {editing ? (
          <label className="flex items-center gap-2 text-sm text-zaio-ink/80">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (unchecked = this account can no longer sign in)
          </label>
        ) : null}
        <ModalActions saving={saving} onClose={onClose} saveLabel={editing ? "Save changes" : "Create administrator"} />
      </form>
    </ModalShell>
  );
}
