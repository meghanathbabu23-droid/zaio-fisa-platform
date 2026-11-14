import { useCallback, useEffect, useState } from "react";
import {
  createStudent,
  deleteStudent,
  fetchCohorts,
  fetchStudents,
  updateStudent,
} from "../api";
import { PageHeader } from "../components/PageHeader";
import { StudentFormModal } from "../components/StudentFormModal";
import type { Cohort, Student, StudentInput } from "../types";
import { Button } from "../components/ui/Button";
import { StateBanner } from "../components/ui/StateBanner";
import { Badge } from "../components/ui/Badge";

const empty: StudentInput = {
  firstName: "",
  lastName: "",
  email: "",
  phone: null,
  cohortId: "",
};

export function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchStudents(), fetchCohorts()])
      .then(([s, c]) => {
        setStudents(s);
        setCohorts(c);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(data: StudentInput) {
    setSaving(true);
    setError(null);
    try {
      if (editing) await updateStudent(editing.id, data);
      else await createStudent(data);
      setModalOpen(false);
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Students"
        description="Registered learners — OTP login uses the email address on file."
        action={
          <Button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            New student
          </Button>
        }
      />
      <div className="flex-1 p-8">
        {error ? (
          <StateBanner tone="error" className="mb-4">
            {error}
          </StateBanner>
        ) : null}
        <TableShell loading={loading} empty={students.length === 0} emptyText="No students yet.">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-zaio-cloud bg-zaio-paper/80 text-xs font-medium uppercase tracking-wide text-zaio-ink/50">
              <tr>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Phone</th>
                <th className="px-6 py-3">Cohort</th>
                <th className="px-6 py-3">Registration</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zaio-cloud">
              {students.map((s) => (
                <tr key={s.id} className="hover:bg-zaio-paper/50 transition-colors">
                  <td className="px-6 py-4 font-medium">
                    {s.firstName} {s.lastName}
                  </td>
                  <td className="px-6 py-4">{s.email}</td>
                  <td className="px-6 py-4">{s.phone ?? "—"}</td>
                  <td className="px-6 py-4">{s.cohort?.name ?? "—"}</td>
                  <td className="px-6 py-4">
                    {s.isTestRegistration ? (
                      <Badge tone="warning">Internal test registration</Badge>
                    ) : (
                      <span className="text-zaio-ink/40">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      className="mr-3 text-zaio-blue"
                      onClick={() => {
                        setEditing(s);
                        setModalOpen(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-red-600"
                      onClick={async () => {
                        if (!confirm(`Delete ${s.firstName} ${s.lastName}?`)) return;
                        await deleteStudent(s.id);
                        load();
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </div>
      {modalOpen ? (
        <StudentFormModal
          title={editing ? "Edit student" : "New student"}
          cohorts={cohorts}
          initial={
            editing
              ? {
                  firstName: editing.firstName,
                  lastName: editing.lastName,
                  email: editing.email,
                  phone: editing.phone,
                  cohortId: editing.cohortId,
                }
              : empty
          }
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

function TableShell({
  loading,
  empty,
  emptyText,
  children,
}: {
  loading: boolean;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zaio-cloud bg-zaio-card shadow-sm">
      {loading ? (
        <p className="px-6 py-10 text-sm text-zaio-ink/50">Loading…</p>
      ) : empty ? (
        <p className="px-6 py-10 text-center text-sm text-zaio-ink/60">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </div>
  );
}
