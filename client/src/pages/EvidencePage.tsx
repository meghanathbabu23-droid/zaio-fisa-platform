import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchCohorts,
  fetchEvidenceList,
  fetchExams,
  fetchStudents,
  syncAllEvidence,
} from "../api";
import { downloadEvidenceSummaryXlsx } from "../lib/exportEvidence";
import { PageHeader } from "../components/PageHeader";
import type { Cohort, EvidenceArtifactStatus, EvidenceListRow, Exam, Student } from "../types";
import { Button } from "../components/ui/Button";
import { Badge, type BadgeTone } from "../components/ui/Badge";
import { StateBanner } from "../components/ui/StateBanner";
import { EmptyState } from "../components/ui/EmptyState";

const STATUS_TONE: Record<EvidenceArtifactStatus, BadgeTone> = {
  PRESENT: "success",
  MISSING: "error",
  SIMULATED: "warning",
};

export function EvidencePage() {
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [rows, setRows] = useState<EvidenceListRow[]>([]);
  const [cohortId, setCohortId] = useState("");
  const [examId, setExamId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [artifactStatus, setArtifactStatus] = useState<EvidenceArtifactStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoNote, setDemoNote] = useState("");

  useEffect(() => {
    Promise.all([fetchCohorts(), fetchExams(), fetchStudents()])
      .then(([c, e, s]) => {
        setCohorts(c);
        setExams(e);
        setStudents(s);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchEvidenceList({
      cohortId: cohortId || undefined,
      examId: examId || undefined,
      studentId: studentId || undefined,
      artifactStatus: artifactStatus || undefined,
    })
      .then((data) => {
        setRows(data.rows);
        setDemoNote(data.demoNote);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => setLoading(false));
  }, [cohortId, examId, studentId, artifactStatus]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSyncAll() {
    setSyncing(true);
    try {
      await syncAllEvidence();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Evidence management"
        description="Central index of exam artefacts per assignment. Original records stay in place; downloads are assembled for demo admins only."
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={syncing} onClick={() => void handleSyncAll()}>
              {syncing ? "Syncing…" : "Rebuild all indexes"}
            </Button>
            <Button type="button" size="sm" disabled={rows.length === 0} onClick={() => downloadEvidenceSummaryXlsx(rows)}>
              Download summary (Excel)
            </Button>
          </div>
        }
      />
      <div className="flex-1 space-y-4 p-8">
        {demoNote ? (
          <p className="rounded-lg border border-dashed border-zaio-cloud bg-zaio-card px-4 py-2 text-xs text-zaio-ink/60">
            {demoNote}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <select
            value={cohortId}
            onChange={(e) => setCohortId(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">All cohorts</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={examId}
            onChange={(e) => setExamId(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">All exams</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">All students</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName}
              </option>
            ))}
          </select>
          <select
            value={artifactStatus}
            onChange={(e) => setArtifactStatus(e.target.value as EvidenceArtifactStatus | "")}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">All artifact statuses</option>
            <option value="PRESENT">Present only</option>
            <option value="MISSING">Missing only</option>
            <option value="SIMULATED">Simulated only</option>
          </select>
        </div>

        {error ? <StateBanner tone="error">{error}</StateBanner> : null}
        {loading ? (
          <p className="text-sm text-zaio-ink/60">Loading evidence…</p>
        ) : rows.length === 0 ? (
          <EmptyState>No assignments match these filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zaio-cloud bg-zaio-card">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zaio-cloud bg-zaio-paper/80 text-xs font-medium uppercase tracking-wide text-zaio-ink/60">
                <tr>
                  <th className="px-4 py-3">Cohort</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Exam</th>
                  <th className="px-4 py-3">Submission</th>
                  <th className="px-4 py-3">Recording</th>
                  <th className="px-4 py-3">Artifacts</th>
                  <th className="px-4 py-3">Synced</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.assignmentId} className="border-b last:border-0">
                    <td className="px-4 py-3">{r.cohort.name}</td>
                    <td className="px-4 py-3">
                      {r.student.firstName} {r.student.lastName}
                    </td>
                    <td className="px-4 py-3">
                      {r.exam.title}
                      <span className="ml-1 text-xs text-zaio-ink/50">({r.exam.type})</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{r.submissionStatus}</td>
                    <td className="px-4 py-3 text-xs">{r.recordingStatus}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{r.artifactCount}</span>
                      {r.missingCount > 0 ? (
                        <span className="ml-2 text-xs text-red-700">{r.missingCount} missing</span>
                      ) : null}
                      {r.simulatedCount > 0 ? (
                        <span className="ml-2 text-xs text-amber-800">{r.simulatedCount} simulated</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-zaio-ink/60">
                      {new Date(r.lastSyncedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/evidence/${r.assignmentId}`}
                        className="text-zaio-blue hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && artifactStatus ? (
          <p className="text-xs text-zaio-ink/50">
            Artifact list below each row is filtered to <strong>{artifactStatus}</strong> items only;
            counts in the table reflect all artefacts.
          </p>
        ) : null}
      </div>
    </>
  );
}

export function EvidenceStatusPill({ status }: { status: EvidenceArtifactStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}
