import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStudentAssignments, logoutStudent } from "../../api";
import { getStudentToken } from "../../student/session";
import type { ExamAssignment } from "../../types";
import { Logo } from "../../components/ui/Logo";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";

function statusBadgeTone(status: ExamAssignment["status"]) {
  if (status === "SUBMITTED") return "success" as const;
  if (status === "IN_PROGRESS") return "warning" as const;
  return "neutral" as const;
}

function statusLabel(status: ExamAssignment["status"]) {
  if (status === "SUBMITTED") return "Submitted";
  if (status === "IN_PROGRESS") return "In progress";
  return "Assigned";
}

export function StudentHomePage() {
  const [assignments, setAssignments] = useState<ExamAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getStudentToken()) {
      setLoading(false);
      return;
    }
    fetchStudentAssignments()
      .then(setAssignments)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-zaio-paper">
      <header className="border-b border-zaio-cloud bg-white px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Logo />
            <div className="border-l border-zaio-cloud pl-4">
              <p className="font-display text-lg font-semibold text-zaio-ink">My exams</p>
              <p className="text-xs text-zaio-ink/50">Zaio FISA student portal</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={async () => {
              await logoutStudent();
              window.location.href = "/student/login";
            }}
          >
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {loading ? (
          <p className="text-sm text-zaio-ink/60">Loading your exams…</p>
        ) : assignments.length === 0 ? (
          <EmptyState>No exam assignments yet. Ask your facilitator to assign an exam.</EmptyState>
        ) : (
          assignments.map((a) => (
            <article key={a.id} className="rounded-xl border border-zaio-cloud bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display font-semibold text-zaio-ink">{a.exam?.title}</h2>
                  <p className="mt-1 text-sm text-zaio-ink/60">
                    <span className="font-medium text-zaio-ink/80">{a.exam?.type}</span> ·{" "}
                    {a.exam?.durationMinutes} minutes
                  </p>
                </div>
                <Badge tone={statusBadgeTone(a.status)}>{statusLabel(a.status)}</Badge>
              </div>
              {a.attempt?.scorePercent != null ? (
                <p className="mt-2 text-sm">
                  Score: <strong>{a.attempt.scorePercent.toFixed(0)}%</strong> (auto-marked)
                </p>
              ) : null}
              {a.exam?.type === "PRACTICAL" && a.workspace?.lastSavedAt ? (
                <p className="mt-1 text-xs text-zaio-ink/50">
                  Last saved {new Date(a.workspace.lastSavedAt).toLocaleString()}
                </p>
              ) : null}
              <div className="mt-4">
                {a.exam?.type === "PRACTICAL" ? (
                  a.status === "SUBMITTED" || a.workspace?.lockedAt ? (
                    <span className="text-sm text-zaio-ink/50">Practical submitted (locked)</span>
                  ) : (
                    <Link
                      to={
                        a.status === "IN_PROGRESS"
                          ? `/student/practical/${a.id}`
                          : `/student/proctoring/${a.id}?next=practical`
                      }
                      className="inline-block rounded-lg bg-zaio-blue px-4 py-2 text-sm font-medium text-white hover:bg-zaio-deep"
                    >
                      {a.status === "IN_PROGRESS" ? "Continue practical" : "Start (proctoring)"}
                    </Link>
                  )
                ) : a.status === "SUBMITTED" ? (
                  <span className="text-sm text-zaio-ink/50">Submitted</span>
                ) : a.exam?.type === "MCQ" ? (
                  <Link
                    to={
                      a.status === "IN_PROGRESS"
                        ? `/student/exam/${a.id}`
                        : `/student/proctoring/${a.id}?next=mcq`
                    }
                    className="inline-block rounded-lg bg-zaio-blue px-4 py-2 text-sm font-medium text-white hover:bg-zaio-deep"
                  >
                    {a.status === "IN_PROGRESS" ? "Continue exam" : "Start (proctoring)"}
                  </Link>
                ) : null}
              </div>
            </article>
          ))
        )}
      </main>
    </div>
  );
}
