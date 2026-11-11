import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAssignments, fetchCohorts, fetchExams, fetchStudents } from "../api";
import { PageHeader } from "../components/PageHeader";
import { SummaryCard } from "../components/SummaryCard";
import type { Cohort } from "../types";
import { daysUntil, formatDate } from "../lib/dates";
import { StateBanner } from "../components/ui/StateBanner";

export function DashboardPage() {
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [examCount, setExamCount] = useState(0);
  const [assignmentCount, setAssignmentCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchCohorts(), fetchStudents(), fetchExams(), fetchAssignments()])
      .then(([c, s, e, a]) => {
        setCohorts(c);
        setStudentCount(s.length);
        setExamCount(e.length);
        setAssignmentCount(a.length);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const active = cohorts.filter(
    (c) => new Date(c.startDate) <= now && new Date(c.examDate) >= now
  );
  const upcomingExams = cohorts.filter((c) => {
    const d = daysUntil(c.examDate);
    return d >= 0 && d <= 30;
  });
  const recent = [...cohorts]
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
    .slice(0, 5);
  const demoCohort = cohorts.find((c) => c.name.startsWith("Nov 14 Demo"));
  const recentIds = new Set(recent.map((c) => c.id));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of FISA cohorts and upcoming assessments."
      />
      <div className="flex-1 space-y-8 p-8">
        {error ? <StateBanner tone="error">{error}</StateBanner> : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Total cohorts"
            value={loading ? "—" : cohorts.length}
            hint="All programmes"
          />
          <SummaryCard
            label="Active cohorts"
            value={loading ? "—" : active.length}
            hint="Between start and exam"
            accent="blue"
          />
          <SummaryCard
            label="Exams in 30 days"
            value={loading ? "—" : upcomingExams.length}
            hint="Needs scheduling review"
            accent="sun"
          />
          <SummaryCard
            label="Students"
            value={loading ? "—" : studentCount}
            hint={`${examCount} exams · ${assignmentCount} assignments`}
            accent="ink"
          />
        </div>
        <section className="rounded-2xl border border-zaio-cloud bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zaio-cloud px-6 py-4">
            <h2 className="font-display text-lg font-semibold text-zaio-ink">Recent cohorts</h2>
            <Link
              to="/cohorts"
              className="text-sm font-medium text-zaio-blue hover:underline"
            >
              Manage cohorts
            </Link>
          </div>
          {loading ? (
            <p className="px-6 py-8 text-sm text-zaio-ink/50">Loading…</p>
          ) : recent.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm text-zaio-ink/60">No cohorts yet.</p>
              <Link
                to="/cohorts"
                className="mt-3 inline-block rounded-lg bg-zaio-blue px-4 py-2 text-sm font-medium text-white hover:bg-zaio-blue/90"
              >
                Create your first cohort
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-zaio-cloud">
              {demoCohort && !recentIds.has(demoCohort.id) ? (
                <CohortRow key={demoCohort.id} cohort={demoCohort} pinned />
              ) : null}
              {recent.map((c) => (
                <CohortRow key={c.id} cohort={c} pinned={c.id === demoCohort?.id} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function CohortRow({ cohort, pinned }: { cohort: Cohort; pinned?: boolean }) {
  return (
    <li
      className={[
        "flex flex-wrap items-center justify-between gap-2 px-6 py-4",
        pinned ? "bg-zaio-sun/15" : "",
      ].join(" ")}
    >
      <span>
        {pinned ? (
          <span className="mr-2 rounded-full bg-zaio-sun px-2 py-0.5 text-xs font-semibold text-zaio-ink">
            Nov 14 demo
          </span>
        ) : null}
        <span className="font-medium text-zaio-ink">{cohort.name}</span>
        <span className="ml-2 text-sm text-zaio-ink/50">{cohort.programme}</span>
      </span>
      <span className="text-sm text-zaio-ink/60">Exam {formatDate(cohort.examDate)}</span>
    </li>
  );
}
