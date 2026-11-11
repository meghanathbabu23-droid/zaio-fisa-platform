import { useCallback, useEffect, useState } from "react";
import {
  createPracticalTestCase,
  deletePracticalTestCase,
  fetchPracticalTestCases,
} from "../api";
import type { PracticalTestCase, PracticalTestKind } from "../types";
import { StateBanner } from "./ui/StateBanner";
import { Button } from "./ui/Button";

const KIND_LABELS: Record<PracticalTestKind, string> = {
  HTML_CONTAINS: "HTML contains text",
  CSS_CONTAINS: "CSS contains text",
  JS_CONTAINS: "JavaScript contains text",
  HTML_SELECTOR: "HTML has element (selector)",
  FILE_REGEX: "File matches regex",
};

const emptyCase = (): Omit<PracticalTestCase, "id" | "examId" | "sortOrder"> => ({
  label: "",
  kind: "HTML_CONTAINS",
  targetFile: null,
  expression: "",
  points: 1,
});

export function PracticalTestCasesModal({
  examId,
  examTitle,
  onClose,
}: {
  examId: string;
  examTitle: string;
  onClose: () => void;
}) {
  const [cases, setCases] = useState<PracticalTestCase[]>([]);
  const [draft, setDraft] = useState(emptyCase());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchPracticalTestCases(examId)
      .then(setCases)
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [examId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addCase(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.label.trim() || !draft.expression.trim()) return;
    setError(null);
    try {
      await createPracticalTestCase(examId, draft);
      setDraft(emptyCase());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zaio-ink/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-zaio-cloud bg-white shadow-xl">
        <div className="border-b border-zaio-cloud px-6 py-4">
          <h2 className="font-display text-lg font-semibold text-zaio-ink">Practical test cases</h2>
          <p className="text-xs text-zaio-ink/50">{examTitle}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {error ? (
            <div className="mb-2">
              <StateBanner tone="error">{error}</StateBanner>
            </div>
          ) : null}
          <p className="mb-4 text-xs text-zaio-ink/60">
            Automated checks run on final submission. Scores are advisory until an assessor approves a
            final mark.
          </p>
          <ul className="mb-6 space-y-2">
            {cases.map((c) => (
              <li key={c.id} className="flex items-start justify-between rounded-lg border border-zaio-cloud p-3 text-sm">
                <div>
                  <p className="font-medium text-zaio-ink">{c.label}</p>
                  <p className="text-xs text-zaio-ink/50">
                    {KIND_LABELS[c.kind]} · {c.points} pt{c.points > 1 ? "s" : ""}
                    {c.targetFile ? ` · ${c.targetFile}` : ""}
                  </p>
                  <code className="mt-1 block text-xs text-zaio-ink/70">{c.expression}</code>
                </div>
                <button
                  type="button"
                  className="text-xs text-red-600"
                  onClick={async () => {
                    await deletePracticalTestCase(examId, c.id);
                    load();
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
            {cases.length === 0 ? (
              <li className="text-sm text-zaio-ink/50">No test cases yet.</li>
            ) : null}
          </ul>
          <form onSubmit={addCase} className="space-y-3 rounded-lg bg-zaio-paper/80 p-4">
            <p className="text-sm font-medium text-zaio-ink">Add test case</p>
            <input
              className="input"
              placeholder="Label (e.g. Page has main heading)"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
            <select
              className="input"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as PracticalTestKind })}
            >
              {(Object.keys(KIND_LABELS) as PracticalTestKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Target file (optional, e.g. index.html)"
              value={draft.targetFile ?? ""}
              onChange={(e) => setDraft({ ...draft, targetFile: e.target.value || null })}
            />
            <input
              className="input"
              placeholder="Expression (text, selector, or regex)"
              value={draft.expression}
              onChange={(e) => setDraft({ ...draft, expression: e.target.value })}
            />
            <input
              type="number"
              min={1}
              className="input"
              value={draft.points}
              onChange={(e) => setDraft({ ...draft, points: Number(e.target.value) })}
            />
            <Button type="submit" size="sm">
              Add test case
            </Button>
          </form>
        </div>
        <div className="border-t border-zaio-cloud px-6 py-3 text-right">
          <Button type="button" variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
