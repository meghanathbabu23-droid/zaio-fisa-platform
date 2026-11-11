import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchAssessorAssignmentDetail,
  rerunPracticalTests,
  saveAssessorReview,
} from "../api";
import type { AssessorAssignmentDetail, TestCaseResult } from "../types";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { StateBanner } from "../components/ui/StateBanner";

export function AssessorReviewPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [data, setData] = useState<AssessorAssignmentDetail | null>(null);
  const [activeFile, setActiveFile] = useState("index.html");
  const [finalScore, setFinalScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!assignmentId) return;
    fetchAssessorAssignmentDetail(assignmentId)
      .then((d) => {
        setData(d);
        if (d.submission?.files[0]) setActiveFile(d.submission.files[0].filename);
        if (d.review?.finalScorePercent != null) {
          setFinalScore(String(d.review.finalScorePercent));
        } else if (d.automated) {
          setFinalScore(String(Math.round(d.automated.scorePercent)));
        }
        setFeedback(d.review?.feedback ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return <p className="p-8 text-sm">{error ?? "Loading…"}</p>;
  }

  const results = (data.automated?.report?.results ?? []) as TestCaseResult[];
  const fileContent =
    data.submission?.files.find((f) => f.filename === activeFile)?.content ?? "";

  async function saveReview() {
    if (!assignmentId) return;
    const score = Number(finalScore);
    if (Number.isNaN(score) || score < 0 || score > 100) {
      setError("Final score must be between 0 and 100.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveAssessorReview(assignmentId, score, feedback);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-zaio-paper">
      <header className="border-b border-zaio-cloud bg-white px-6 py-4">
        <Link to="/assessor/practical" className="text-sm text-zaio-blue">
          ← Dashboard
        </Link>
        <h1 className="mt-2 font-display text-xl font-semibold text-zaio-ink">
          {data.assignment.exam?.title} — {data.assignment.student?.firstName}{" "}
          {data.assignment.student?.lastName}
        </h1>
        {data.submission ? (
          <p className="text-xs text-zaio-ink/50">
            Submitted {new Date(data.submission.submittedAt).toLocaleString()}
          </p>
        ) : null}
      </header>
      {error ? (
        <StateBanner tone="error" bleed>
          {error}
        </StateBanner>
      ) : null}
      <div className="grid flex-1 gap-4 p-6 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-zaio-ink">Automated test report</h2>
            <button
              type="button"
              className="text-xs text-zaio-blue"
              onClick={async () => {
                if (!assignmentId) return;
                await rerunPracticalTests(assignmentId);
                load();
              }}
            >
              Re-run tests
            </button>
          </div>
          {data.automated ? (
            <p className="mt-2 text-sm">
              Automated score:{" "}
              <strong className="font-mono">{data.automated.scorePercent.toFixed(1)}%</strong> (
              {data.automated.earnedPoints}/{data.automated.maxPoints} points) · Ran{" "}
              {new Date(data.automated.ranAt).toLocaleString()}
            </p>
          ) : (
            <p className="mt-2 text-sm text-zaio-ink/50">No automated run yet.</p>
          )}
          <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto text-sm">
            {results.map((r) => (
              <li
                key={r.testCaseId}
                className={`rounded-lg border px-3 py-2 ${r.passed ? "border-emerald-200 bg-emerald-50/50" : "border-zaio-cloud"}`}
              >
                <p className="font-medium">{r.label}</p>
                <p className="text-xs text-zaio-ink/60">
                  {r.passed ? "Passed" : "Not met"} · {r.earned}/{r.points} pts — {r.detail}
                </p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="font-display text-sm font-semibold text-zaio-ink">Assessor decision</h2>
          <p className="mt-1 text-xs text-zaio-ink/50">
            Set the assessor-approved final score and feedback. This is stored separately from the
            automated result.
          </p>
          <label className="mt-4 block text-sm">
            Assessor-approved score (%)
            <input
              className="input mt-1 font-mono"
              type="number"
              min={0}
              max={100}
              value={finalScore}
              onChange={(e) => setFinalScore(e.target.value)}
            />
          </label>
          {data.automated ? (
            <p className="mt-1 text-xs text-zaio-ink/40">
              Automated reference: {data.automated.scorePercent.toFixed(1)}%
            </p>
          ) : null}
          <label className="mt-3 block text-sm">
            Feedback
            <textarea
              className="input mt-1 min-h-[100px]"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
          <Button type="button" className="mt-4" disabled={saving} onClick={() => void saveReview()}>
            {saving ? "Saving…" : "Save assessor review"}
          </Button>
          {data.reviewLog.length > 0 ? (
            <div className="mt-6 border-t pt-4">
              <p className="text-xs font-medium uppercase text-zaio-ink/50">Decision history</p>
              <ul className="mt-2 space-y-1 text-xs text-zaio-ink/70">
                {data.reviewLog.map((l) => (
                  <li key={l.id}>
                    {new Date(l.createdAt).toLocaleString()} — final {l.finalScorePercent ?? "—"}%
                    (auto {l.automatedScorePercent.toFixed(0)}%)
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="font-display text-sm font-semibold text-zaio-ink">Submitted code</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {data.submission?.files.map((f) => (
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
          <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-zaio-ink p-4 text-xs text-zaio-paper">
            {fileContent}
          </pre>
        </Card>
      </div>
    </div>
  );
}
