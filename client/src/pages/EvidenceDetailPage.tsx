import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  downloadEvidenceArtifact,
  downloadEvidenceSummaryReport,
  fetchEvidenceDetail,
} from "../api";
import { EvidenceStatusPill } from "./EvidencePage";
import { PageHeader } from "../components/PageHeader";
import type { EvidenceDetail } from "../types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { StateBanner } from "../components/ui/StateBanner";

const KIND_LABELS: Record<string, string> = {
  MCQ_ATTEMPT: "MCQ answers",
  PRACTICAL_SUBMISSION: "Practical submission",
  CODE_HISTORY: "Code history",
  PROCTORING_RECORDING: "Recording file",
  PROCTORING_EVENTS: "Proctoring events",
  ASSESSOR_REVIEW: "Assessor review",
  MODERATION: "Moderation",
};

export function EvidenceDetailPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [data, setData] = useState<EvidenceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!assignmentId) return;
    setLoading(true);
    fetchEvidenceDetail(assignmentId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => setLoading(false));
  }, [assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDownloadSummary() {
    if (!assignmentId) return;
    try {
      await downloadEvidenceSummaryReport(assignmentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }

  async function handleDownloadArtifact(artifactId: string) {
    if (!assignmentId) return;
    try {
      await downloadEvidenceArtifact(assignmentId, artifactId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }

  if (!assignmentId) {
    return <p className="p-8 text-sm">Missing assignment.</p>;
  }

  return (
    <>
      <PageHeader
        title="Evidence detail"
        description="View metadata and download exports. Each download is logged in the audit trail below."
        action={
          <Button type="button" size="sm" onClick={() => void handleDownloadSummary()}>
            Download JSON summary report
          </Button>
        }
      />
      <div className="flex-1 space-y-6 p-8">
        <Link to="/evidence" className="text-sm text-zaio-blue hover:underline">
          ← Back to evidence
        </Link>

        {error ? <StateBanner tone="error">{error}</StateBanner> : null}
        {loading || !data ? (
          <p className="text-sm text-zaio-ink/60">Loading…</p>
        ) : (
          <>
            <Card>
              <h2 className="font-display font-semibold text-zaio-ink">Assignment</h2>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-zaio-ink/50">Student</dt>
                  <dd>
                    {data.student.firstName} {data.student.lastName} ({data.student.email})
                  </dd>
                </div>
                <div>
                  <dt className="text-zaio-ink/50">Cohort</dt>
                  <dd>{data.cohort.name}</dd>
                </div>
                <div>
                  <dt className="text-zaio-ink/50">Exam</dt>
                  <dd>
                    {data.exam.title} · {data.exam.type}
                  </dd>
                </div>
                <div>
                  <dt className="text-zaio-ink/50">Submission status</dt>
                  <dd className="font-mono text-xs">{data.evidence.submissionStatus}</dd>
                </div>
                <div>
                  <dt className="text-zaio-ink/50">Recording status</dt>
                  <dd className="text-xs">{data.evidence.recordingStatus}</dd>
                </div>
                <div>
                  <dt className="text-zaio-ink/50">Last synced</dt>
                  <dd>{new Date(data.evidence.lastSyncedAt).toLocaleString()}</dd>
                </div>
              </dl>
            </Card>

            <Card>
              <h2 className="font-display font-semibold text-zaio-ink">Evidence artefacts</h2>
              <p className="mt-1 text-xs text-zaio-ink/50">
                <span className="text-emerald-800">PRESENT</span> = exam artefacts (MCQ, submissions,
                etc.). <span className="text-amber-800">SIMULATED</span> = a demo proctoring log or
                file that is not certified evidence.{" "}
                <span className="text-red-700">MISSING</span> = not uploaded or not found.
              </p>
              <ul className="mt-4 space-y-3">
                {data.evidence.artifacts.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zaio-cloud px-4 py-3"
                  >
                    <div>
                      <p className="font-medium text-zaio-ink">{a.label}</p>
                      <p className="text-xs text-zaio-ink/60">
                        {KIND_LABELS[a.kind] ?? a.kind}
                        {a.capturedAt
                          ? ` · ${new Date(a.capturedAt).toLocaleString()}`
                          : ""}
                        {a.sizeBytes != null ? ` · ${(a.sizeBytes / 1024).toFixed(0)} KB` : ""}
                        {a.filePath ? ` · ${a.filePath}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <EvidenceStatusPill status={a.status} />
                      {a.status !== "MISSING" &&
                      (a.kind !== "PROCTORING_RECORDING" || a.filePath) ? (
                        <button
                          type="button"
                          className="text-sm text-zaio-blue hover:underline"
                          onClick={() => void handleDownloadArtifact(a.id)}
                        >
                          Download
                        </button>
                      ) : a.status === "MISSING" ? (
                        <span className="text-xs text-zaio-ink/40">Not available</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <h2 className="font-display font-semibold text-zaio-ink">Audit trail</h2>
              <p className="mt-1 text-xs text-zaio-ink/50">
                Interim shared-key admin protection (not individual admin accounts). Optional header{" "}
                <code>X-Evidence-Actor</code> on API calls.
              </p>
              {data.auditTrail.length === 0 ? (
                <p className="mt-3 text-sm text-zaio-ink/50">No audit entries yet.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {data.auditTrail.map((l) => (
                    <li key={l.id} className="border-b border-zaio-ink/5 pb-2 last:border-0">
                      <span className="font-mono text-xs text-zaio-ink/60">
                        {new Date(l.createdAt).toLocaleString()}
                      </span>{" "}
                      <strong>{l.action}</strong> · {l.actorLabel} — {l.detail}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
