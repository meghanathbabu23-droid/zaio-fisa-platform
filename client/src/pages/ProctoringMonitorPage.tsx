import { useCallback, useEffect, useState } from "react";
import { fetchProctoringMonitor } from "../api";
import { PageHeader } from "../components/PageHeader";
import type { ProctoringMonitorSession } from "../types";
import { Card } from "../components/ui/Card";
import { StateBanner } from "../components/ui/StateBanner";
import { EmptyState } from "../components/ui/EmptyState";

export function ProctoringMonitorPage() {
  const [sessions, setSessions] = useState<ProctoringMonitorSession[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchProctoringMonitor(activeOnly)
      .then((r) => setSessions(r.sessions))
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => setLoading(false));
  }, [activeOnly]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <>
      <PageHeader
        title="Proctoring monitor"
        description="Live demo sessions, recording metadata and advisory event logs. Flags never auto-sanction learners."
      />
      <div className="flex-1 space-y-4 p-8">
        <p className="rounded-lg border border-dashed border-zaio-cloud bg-white px-4 py-2 text-xs text-zaio-ink/60">
          Simulated storage: WebM files land under <code>server/data/recordings/</code> (gitignored).
          Not suitable for production evidence chains.
        </p>
        <label className="flex items-center gap-2 text-sm text-zaio-ink/80">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          Show active sessions only
        </label>
        {error ? <StateBanner tone="error">{error}</StateBanner> : null}
        {loading && sessions.length === 0 ? (
          <p className="text-sm text-zaio-ink/60">Loading…</p>
        ) : sessions.length === 0 ? (
          <EmptyState>No sessions to show.</EmptyState>
        ) : (
          <div className="space-y-4">
            {sessions.map((s) => (
              <Card key={s.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="font-display font-semibold text-zaio-ink">{s.studentName}</h2>
                    <p className="text-sm text-zaio-ink/60">{s.examTitle}</p>
                  </div>
                  <div className="text-right text-xs">
                    <p>
                      Status: <strong>{s.status}</strong>
                    </p>
                    <p>Webcam: {s.webcamStatus}</p>
                    <p>Screen: {s.screenStatus}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-zaio-ink/50">
                  Started {new Date(s.startedAt).toLocaleString()}
                  {s.endedAt ? ` · Ended ${new Date(s.endedAt).toLocaleString()}` : ""} ·{" "}
                  {s.eventCount} events
                </p>
                {s.recordings.length > 0 ? (
                  <ul className="mt-2 text-xs">
                    {s.recordings.map((r) => (
                      <li key={r.filename}>
                        {r.kind}: {r.filename} ({(r.sizeBytes / 1024).toFixed(0)} KB)
                        {"captureTier" in r && r.captureTier ? (
                          <span className="ml-1 text-zaio-ink/50">
                            ·{" "}
                            {r.captureTier === "VERIFIED_REAL"
                              ? "non-empty file (size check only)"
                              : "placeholder / below size threshold"}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-amber-800">No recording files uploaded.</p>
                )}
                <ul className="mt-3 max-h-32 overflow-y-auto border-t pt-2 text-xs">
                  {s.recentEvents.map((e, i) => (
                    <li key={i} className="text-zaio-ink/70">
                      {new Date(e.createdAt).toLocaleTimeString()} · {e.type} — {e.message}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
