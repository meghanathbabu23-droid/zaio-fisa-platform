import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAssessorPracticalList } from "../api";
import { PageHeader } from "../components/PageHeader";
import type { AssessorPracticalRow } from "../types";
import { StateBanner } from "../components/ui/StateBanner";
import { Badge } from "../components/ui/Badge";

export function AssessorPracticalPage() {
  const [rows, setRows] = useState<AssessorPracticalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchAssessorPracticalList()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Practical assessor dashboard"
        description="Review submissions, automated test results, and approve final marks."
      />
      <div className="flex-1 p-8">
        <p className="mb-4 rounded-lg border border-zaio-cloud bg-zaio-card px-4 py-2 text-xs text-zaio-ink/60">
          Automated scores are generated from admin-defined test cases. They do not determine
          qualification outcomes — assessors set the approved final score.
        </p>
        {error ? <StateBanner tone="error">{error}</StateBanner> : null}
        <div className="overflow-hidden rounded-2xl border border-zaio-cloud bg-zaio-card shadow-sm">
          {loading ? (
            <p className="px-6 py-10 text-sm text-zaio-ink/60">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zaio-ink/50">
              No submitted practical exams yet.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zaio-cloud bg-zaio-paper/80 text-xs font-medium uppercase tracking-wide text-zaio-ink/50">
                <tr>
                  <th className="px-6 py-3">Student</th>
                  <th className="px-6 py-3">Exam</th>
                  <th className="px-6 py-3">Submitted</th>
                  <th className="px-6 py-3">Automated</th>
                  <th className="px-6 py-3">Assessor-approved</th>
                  <th className="px-6 py-3 text-right">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.assignmentId}>
                    <td className="px-6 py-4 font-medium">{r.studentName}</td>
                    <td className="px-6 py-4">{r.examTitle}</td>
                    <td className="px-6 py-4">
                      {r.submittedAt ? new Date(r.submittedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-6 py-4">
                      {r.automatedScorePercent != null ? (
                        <Badge tone="neutral">{r.automatedScorePercent.toFixed(0)}%</Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {r.finalScorePercent != null ? (
                        <Badge tone="sun">{r.finalScorePercent.toFixed(0)}%</Badge>
                      ) : (
                        <span className="text-zaio-ink/40">Pending</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        to={`/assessor/practical/${r.assignmentId}`}
                        className="text-zaio-blue hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
