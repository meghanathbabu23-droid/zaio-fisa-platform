import { useCallback, useEffect, useState } from "react";
import {
  assignExamToCohort,
  createAssignment,
  deleteAssignment,
  fetchAssignments,
  fetchCohorts,
  fetchExams,
  fetchStudents,
} from "../api";
import { PageHeader } from "../components/PageHeader";
import { PracticalHistoryModal } from "../components/PracticalHistoryModal";
import { formatDate } from "../lib/dates";
import { Button } from "../components/ui/Button";
import { StateBanner } from "../components/ui/StateBanner";
import { Badge, type BadgeTone } from "../components/ui/Badge";
import type { AssignmentStatus } from "../types";

const STATUS_TONE: Record<AssignmentStatus, BadgeTone> = {
  ASSIGNED: "neutral",
  IN_PROGRESS: "warning",
  SUBMITTED: "success",
};

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
};

export function AssignmentsPage() {
  const [assignments, setAssignments] = useState<Awaited<ReturnType<typeof fetchAssignments>>>([]);
  const [exams, setExams] = useState<Awaited<ReturnType<typeof fetchExams>>>([]);
  const [students, setStudents] = useState<Awaited<ReturnType<typeof fetchStudents>>>([]);
  const [cohorts, setCohorts] = useState<Awaited<ReturnType<typeof fetchCohorts>>>([]);
  const [examId, setExamId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [bulkCohortId, setBulkCohortId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyId, setHistoryId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    // Only active exams are offered when creating a NEW assignment — the
    // obsolete/duplicate/QA-audit ones stay out of this picker without
    // being deleted; a student already assigned one keeps full access.
    Promise.all([fetchAssignments(), fetchExams(true), fetchStudents(), fetchCohorts()])
      .then(([a, e, s, c]) => {
        setAssignments(a);
        setExams(e);
        setStudents(s);
        setCohorts(c);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Load failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader title="Exam assignments" description="Link exams to individual students or entire cohorts." />
      <div className="flex-1 space-y-6 p-8">
        {error ? <StateBanner tone="error">{error}</StateBanner> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <form
            className="rounded-xl border border-zaio-cloud bg-zaio-card p-5 shadow-sm"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                await createAssignment(examId, studentId);
                setExamId("");
                setStudentId("");
                load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Assign failed");
              }
            }}
          >
            <h2 className="font-display text-sm font-semibold text-zaio-ink">Assign to one student</h2>
            <div className="mt-3 space-y-2">
              <select className="input" value={examId} onChange={(e) => setExamId(e.target.value)} required>
                <option value="">Select exam</option>
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title}
                  </option>
                ))}
              </select>
              <select className="input" value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
                <option value="">Select student</option>
                {students.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.firstName} {st.lastName}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" className="mt-4">
              Assign
            </Button>
          </form>
          <form
            className="rounded-xl border border-zaio-cloud bg-zaio-card p-5 shadow-sm"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                const res = await assignExamToCohort(examId, bulkCohortId);
                alert(`Assigned to ${res.count} students (demo).`);
                load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Bulk assign failed");
              }
            }}
          >
            <h2 className="font-display text-sm font-semibold text-zaio-ink">Assign to whole cohort</h2>
            <div className="mt-3 space-y-2">
              <select className="input" value={examId} onChange={(e) => setExamId(e.target.value)} required>
                <option value="">Select exam</option>
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={bulkCohortId}
                onChange={(e) => setBulkCohortId(e.target.value)}
                required
              >
                <option value="">Select cohort</option>
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="ink" className="mt-4">
              Bulk assign
            </Button>
          </form>
        </div>
        <div className="overflow-hidden rounded-2xl border border-zaio-cloud bg-zaio-card shadow-sm">
          {loading ? (
            <p className="px-6 py-10 text-sm text-zaio-ink/60">Loading…</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zaio-cloud bg-zaio-paper/80 text-xs font-medium uppercase tracking-wide text-zaio-ink/50">
                <tr>
                  <th className="px-6 py-3">Student</th>
                  <th className="px-6 py-3">Exam</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Score</th>
                  <th className="px-6 py-3">Assigned</th>
                  <th className="px-6 py-3 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td className="px-6 py-4">
                      {a.student?.firstName} {a.student?.lastName}
                    </td>
                    <td className="px-6 py-4">{a.exam?.title}</td>
                    <td className="px-6 py-4">
                      <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                    </td>
                    <td className="px-6 py-4">
                      {a.attempt?.scorePercent != null ? `${a.attempt.scorePercent.toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-6 py-4">{formatDate(a.assignedAt)}</td>
                    <td className="px-6 py-4 text-right">
                      {a.exam?.type === "PRACTICAL" ? (
                        <>
                          <a href={`/assessor/practical/${a.id}`} className="mr-3 text-zaio-blue">
                            Assess
                          </a>
                          <button
                            type="button"
                            className="mr-3 text-zaio-ink/60"
                            onClick={() => setHistoryId(a.id)}
                          >
                            History
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className="text-red-600"
                        onClick={async () => {
                          await deleteAssignment(a.id);
                          load();
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {historyId ? (
        <PracticalHistoryModal assignmentId={historyId} onClose={() => setHistoryId(null)} />
      ) : null}
    </>
  );
}
