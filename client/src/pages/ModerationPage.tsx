import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchModerationQueue } from "../api";
import { PageHeader } from "../components/PageHeader";
import { SummaryCard } from "../components/SummaryCard";
import type { ModerationListItem, ModerationStatus } from "../types";
import { StateBanner } from "../components/ui/StateBanner";
import { Badge, type BadgeTone } from "../components/ui/Badge";

const STATUS_LABEL: Record<ModerationStatus, string> = {
  PENDING: "Pending",
  REVIEWED: "Reviewed",
  COMPLETED: "Completed",
};

const STATUS_TONE: Record<ModerationStatus, BadgeTone> = {
  PENDING: "warning",
  REVIEWED: "brand",
  COMPLETED: "success",
};

export function ModerationPage() {
  const [items, setItems] = useState<ModerationListItem[]>([]);
  const [counts, setCounts] = useState({ pending: 0, reviewed: 0, completed: 0 });
  const [filter, setFilter] = useState<ModerationStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchModerationQueue(filter || undefined)
      .then((data) => {
        setItems(data.items);
        setCounts(data.counts);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Moderation"
        description="Review practical outcomes. Flags are advisory only — they never change marks or disqualify learners."
      />
      <div className="flex-1 space-y-6 p-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryCard label="Pending" value={counts.pending} accent="sun" />
          <SummaryCard label="Reviewed" value={counts.reviewed} accent="blue" />
          <SummaryCard label="Completed" value={counts.completed} accent="ink" />
        </div>
        <div className="flex gap-2 text-sm">
          {(["", "PENDING", "REVIEWED", "COMPLETED"] as const).map((s) => (
            <button
              key={s || "all"}
              type="button"
              onClick={() => setFilter(s)}
              className={`rounded-lg px-3 py-1.5 font-medium ${
                filter === s ? "bg-zaio-blue text-white" : "border border-zaio-cloud bg-white text-zaio-ink"
              }`}
            >
              {s ? STATUS_LABEL[s] : "All"}
            </button>
          ))}
        </div>
        {error ? <StateBanner tone="error">{error}</StateBanner> : null}
        <div className="overflow-hidden rounded-2xl border border-zaio-cloud bg-white shadow-sm">
          {loading ? (
            <p className="px-6 py-10 text-sm text-zaio-ink/60">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zaio-ink/50">Nothing to moderate yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zaio-cloud bg-zaio-paper/80 text-xs font-medium uppercase tracking-wide text-zaio-ink/50">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Exam</th>
                  <th className="px-4 py-3">Auto %</th>
                  <th className="px-4 py-3">Assessor %</th>
                  <th className="px-4 py-3">Advisory flags</th>
                  <th className="px-4 py-3">Mod. status</th>
                  <th className="px-4 py-3 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((row) => (
                  <tr key={row.assignmentId}>
                    <td className="px-4 py-3">
                      {row.studentName}
                      <span className="block text-xs text-zaio-ink/50">{row.cohortName}</span>
                    </td>
                    <td className="px-4 py-3">{row.examTitle}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.automatedScorePercent != null
                        ? `${row.automatedScorePercent.toFixed(0)}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.assessorApprovedPercent != null
                        ? `${row.assessorApprovedPercent.toFixed(0)}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {row.flagCount > 0 ? (
                        <Badge tone="warning">{row.flagCount} advisory</Badge>
                      ) : (
                        <span className="text-xs text-zaio-ink/40">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[row.moderationStatus]}>{STATUS_LABEL[row.moderationStatus]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/moderation/${row.assignmentId}`}
                        className="text-zaio-blue hover:underline"
                      >
                        Inspect
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
