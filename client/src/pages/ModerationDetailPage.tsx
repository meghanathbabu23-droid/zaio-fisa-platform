import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchModerationDetail, saveModerationDecision } from "../api";
import type { ModerationDetail, ModerationStatus, TestCaseResult } from "../types";
import { Button } from "../components/ui/Button";
import { StateBanner } from "../components/ui/StateBanner";
import { Card } from "../components/ui/Card";

const DECISIONS = ["acknowledged", "escalate", "no_action_required", "follow_up"] as const;

export function ModerationDetailPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [detail, setDetail] = useState<ModerationDetail | null>(null);
  const [activeFile, setActiveFile] = useState("index.html");
  const [moderatorName, setModeratorName] = useState("Demo Moderator");
  const [decision, setDecision] = useState<string>(DECISIONS[0]);
  const [comments, setComments] = useState("");
  const [nextStatus, setNextStatus] = useState<ModerationStatus>("REVIEWED");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!assignmentId) return;
    fetchModerationDetail(assignmentId)
      .then((d) => {
        setDetail(d);
        if (d.submission?.files[0]) setActiveFile(d.submission.files[0].filename);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!detail) {
    return <p className="p-8 text-sm">{error ?? "Loading…"}</p>;
  }

  const fileContent =
    detail.submission?.files.find((f) => f.filename === activeFile)?.content ?? "";
  const results = (detail.automated?.report?.results ?? []) as TestCaseResult[];

  async function submitDecision() {
    if (!assignmentId) return;
    setSaving(true);
    setError(null);
    try {
      await saveModerationDecision(assignmentId, {
        moderatorName,
        decision,
        comments,
        status: nextStatus,
      });
      setComments("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-zaio-paper">
      <header className="border-b border-zaio-cloud bg-white px-6 py-4">
        <Link to="/moderation" className="text-sm text-zaio-blue">
          ← Moderation queue
        </Link>
        <h1 className="mt-2 font-display text-xl font-semibold text-zaio-ink">
          {detail.assignment.exam?.title} — {detail.assignment.student?.firstName}{" "}
          {detail.assignment.student?.lastName}
        </h1>
        <p className="text-xs text-zaio-ink/50">
          Moderation status: <strong>{detail.moderation.status}</strong>
        </p>
      </header>
      {error ? <StateBanner tone="error" bleed>{error}</StateBanner> : null}
      <div className="space-y-6 p-6">
        {detail.moderation.advisoryFlags.length > 0 ? (
          <section className="rounded-xl border border-zaio-sun/40 bg-zaio-sun/10 p-4">
            <h2 className="text-sm font-semibold text-zaio-ink">Advisory flags (no automatic action)</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {detail.moderation.advisoryFlags.map((f) => (
                <li key={f.code}>
                  <span className="font-mono text-xs text-zaio-ink/50">{f.code}</span> — {f.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="text-sm font-semibold">Scores (unchanged by moderation)</h2>
            <p className="mt-2 text-sm">
              Automated:{" "}
              <strong className="font-mono">
                {detail.automated ? `${detail.automated.scorePercent.toFixed(1)}%` : "—"}
              </strong>
            </p>
            <p className="text-sm">
              Assessor-approved:{" "}
              <strong className="font-mono">
                {detail.assessorReview?.finalScorePercent != null
                  ? `${detail.assessorReview.finalScorePercent.toFixed(1)}%`
                  : "—"}
              </strong>
            </p>
            {detail.assessorReview?.feedback ? (
              <p className="mt-2 text-xs text-zaio-ink/60">Assessor: {detail.assessorReview.feedback}</p>
            ) : null}
            <ul className="mt-3 max-h-40 overflow-y-auto text-xs">
              {results.map((r) => (
                <li key={r.testCaseId} className="border-t py-1">
                  {r.label}: {r.passed ? "met" : "not met"} ({r.earned}/{r.points})
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold">Record moderation decision</h2>
            <p className="text-xs text-zaio-ink/50">Logged with timestamp; does not alter assessment marks.</p>
            <label className="mt-3 block text-sm">
              Moderator name
              <input className="input mt-1" value={moderatorName} onChange={(e) => setModeratorName(e.target.value)} />
            </label>
            <label className="mt-2 block text-sm">
              Decision
              <select className="input mt-1" value={decision} onChange={(e) => setDecision(e.target.value)}>
                {DECISIONS.map((d) => (
                  <option key={d} value={d}>
                    {d.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-2 block text-sm">
              Set case status
              <select
                className="input mt-1"
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value as ModerationStatus)}
              >
                <option value="PENDING">Pending</option>
                <option value="REVIEWED">Reviewed</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </label>
            <label className="mt-2 block text-sm">
              Comments
              <textarea className="input mt-1 min-h-[80px]" value={comments} onChange={(e) => setComments(e.target.value)} />
            </label>
            <Button type="button" className="mt-3" disabled={saving} onClick={() => void submitDecision()}>
              {saving ? "Saving…" : "Save to history"}
            </Button>
          </Card>
        </div>

        <Card>
          <h2 className="text-sm font-semibold">Submitted code</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {detail.submission?.files.map((f) => (
              <button
                key={f.filename}
                type="button"
                className={`rounded px-2 py-1 ${activeFile === f.filename ? "bg-zaio-blue text-white" : "bg-zaio-paper"}`}
                onClick={() => setActiveFile(f.filename)}
              >
                {f.filename}
              </button>
            ))}
          </div>
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-zaio-ink p-4 text-xs text-zaio-paper">
            {fileContent}
          </pre>
        </Card>

        {detail.moderation.history.length > 0 ? (
          <Card>
            <h2 className="text-sm font-semibold">Moderation history</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {detail.moderation.history.map((h) => (
                <li key={h.id} className="border-b border-zaio-cloud pb-2">
                  <p className="font-medium">
                    {new Date(h.createdAt).toLocaleString()} · {h.moderatorName} · {h.decision}
                  </p>
                  <p className="text-xs text-zaio-ink/50">Status → {h.statusAfter}</p>
                  {h.comments ? <p className="text-xs">{h.comments}</p> : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
