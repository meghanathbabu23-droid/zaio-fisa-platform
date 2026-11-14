import { useCallback, useEffect, useMemo, useState } from "react";
import { exportResultsXlsx, fetchCohorts, fetchExams, fetchResults, fetchStudents } from "../api";
import { PageHeader } from "../components/PageHeader";
import { SummaryCard } from "../components/SummaryCard";
import type { Cohort, Exam, ResultsRow, ResultsSummary, Student } from "../types";
import { Button } from "../components/ui/Button";
import { StateBanner } from "../components/ui/StateBanner";
import { Badge } from "../components/ui/Badge";

const REVIEW_LABELS: Record<ResultsRow["reviewState"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  pending_review: "Pending assessor review",
  finalised: "Finalised",
};

export function ResultsPage() {
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [summary, setSummary] = useState<ResultsSummary | null>(null);
  const [rows, setRows] = useState<ResultsRow[]>([]);
  const [cohortId, setCohortId] = useState("");
  const [examId, setExamId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    fetchResults({
      cohortId: cohortId || undefined,
      examId: examId || undefined,
      studentId: studentId || undefined,
    })
      .then((data) => {
        setSummary(data.summary);
        setRows(data.rows);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => setLoading(false));
  }, [cohortId, examId, studentId]);

  useEffect(() => {
    load();
  }, [load]);

  const displayScore = useMemo(
    () => (row: ResultsRow) => {
      if (row.exam.type === "MCQ" && row.mcqScorePercent != null) {
        return { label: "MCQ (auto-marked)", value: row.mcqScorePercent };
      }
      if (row.exam.type === "PRACTICAL" && row.assessorApprovedPercent != null) {
        return { label: "Assessor-approved", value: row.assessorApprovedPercent };
      }
      if (row.exam.type === "PRACTICAL" && row.practicalAutomatedPercent != null) {
        return { label: "Practical (automated)", value: row.practicalAutomatedPercent };
      }
      return null;
    },
    []
  );

  return (
    <>
      <PageHeader
        title="Results"
        description="Unified view of assignments, scores, and review status. Scores do not determine qualification outcomes."
        action={
          <Button type="button" disabled={rows.length === 0} onClick={() => exportResultsXlsx(rows)}>
            Export Excel
          </Button>
        }
      />
      <div className="flex-1 space-y-6 p-8">
        <div className="flex flex-wrap gap-3 rounded-xl border border-zaio-cloud bg-zaio-card p-4 shadow-sm">
          <FilterSelect
            label="Cohort"
            value={cohortId}
            onChange={setCohortId}
            options={cohorts.map((c) => ({ value: c.id, label: c.name }))}
          />
          <FilterSelect
            label="Exam"
            value={examId}
            onChange={setExamId}
            options={exams.map((e) => ({ value: e.id, label: `${e.title} (${e.type})` }))}
          />
          <FilterSelect
            label="Student"
            value={studentId}
            onChange={setStudentId}
            options={students.map((s) => ({
              value: s.id,
              label: `${s.firstName} ${s.lastName}`,
            }))}
          />
          {(cohortId || examId || studentId) && (
            <button
              type="button"
              className="self-end text-sm text-zaio-blue"
              onClick={() => {
                setCohortId("");
                setExamId("");
                setStudentId("");
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {summary ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Assignments" value={summary.total} hint="Matching filters" />
            <SummaryCard
              label="Submitted"
              value={summary.submitted}
              hint={`${summary.inProgress} in progress`}
              accent="blue"
            />
            <SummaryCard
              label="Pending review"
              value={summary.pendingReview}
              hint="Practical awaiting assessor"
              accent="sun"
            />
            <SummaryCard
              label="Finalised"
              value={summary.finalised}
              hint={`${summary.notStarted} not started`}
              accent="ink"
            />
          </div>
        ) : null}

        {error ? <StateBanner tone="error">{error}</StateBanner> : null}

        <div className="overflow-hidden rounded-2xl border border-zaio-cloud bg-zaio-card shadow-sm">
          {loading ? (
            <p className="px-6 py-10 text-sm text-zaio-ink/50">Loading results…</p>
          ) : rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zaio-ink/60">No assignments match filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="border-b border-zaio-cloud bg-zaio-paper/80 text-xs font-medium uppercase tracking-wide text-zaio-ink/50">
                  <tr>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Cohort</th>
                    <th className="px-4 py-3">Exam</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">MCQ %</th>
                    <th className="px-4 py-3">Practical auto %</th>
                    <th className="px-4 py-3">Assessor %</th>
                    <th className="px-4 py-3">Review</th>
                    <th className="px-4 py-3">Submitted</th>
                    <th className="px-4 py-3">Feedback</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row) => {
                    const primary = displayScore(row);
                    return (
                      <tr key={row.assignmentId} className="hover:bg-zaio-paper/40">
                        <td className="px-4 py-3">
                          <p className="font-medium">
                            {row.student.firstName} {row.student.lastName}
                          </p>
                          <p className="text-xs text-zaio-ink/50">{row.student.email}</p>
                        </td>
                        <td className="px-4 py-3">{row.cohort.name}</td>
                        <td className="px-4 py-3">
                          {row.exam.title}
                          <span className="ml-1 text-xs text-zaio-ink/40">{row.exam.type}</span>
                        </td>
                        <td className="px-4 py-3">{row.status}</td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {row.mcqScorePercent != null ? `${row.mcqScorePercent.toFixed(0)}%` : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {row.practicalAutomatedPercent != null
                            ? `${row.practicalAutomatedPercent.toFixed(0)}%`
                            : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {row.assessorApprovedPercent != null ? (
                            <span className="font-semibold text-zaio-ink">
                              {row.assessorApprovedPercent.toFixed(0)}%
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <ReviewBadge state={row.reviewState} />
                          {primary ? (
                            <p className="mt-0.5 text-[10px] text-zaio-ink/40">
                              Primary: {primary.label} {primary.value.toFixed(0)}%
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs text-zaio-ink/70">
                          {row.submittedAt ? new Date(row.submittedAt).toLocaleString() : "—"}
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-3 text-xs text-zaio-ink/60">
                          {row.assessorFeedback ?? "—"}
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
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="min-w-[160px] flex-1 text-sm">
      <span className="text-xs font-medium text-zaio-ink/60">{label}</span>
      <select className="input mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReviewBadge({ state }: { state: ResultsRow["reviewState"] }) {
  const tone = state === "finalised" ? "brand" : state === "pending_review" ? "sun" : "neutral";
  return <Badge tone={tone}>{REVIEW_LABELS[state]}</Badge>;
}
