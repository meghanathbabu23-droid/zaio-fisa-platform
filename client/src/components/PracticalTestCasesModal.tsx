import { useCallback, useEffect, useState } from "react";
import {
  createPracticalTestCase,
  deletePracticalTestCase,
  fetchPracticalTestCases,
} from "../api";
import type {
  DomBehaviorAction,
  DomBehaviorCondition,
  DomBehaviorSpec,
  PracticalTestCase,
  PracticalTestKind,
} from "../types";
import { StateBanner } from "./ui/StateBanner";
import { Button } from "./ui/Button";

const KIND_LABELS: Record<PracticalTestKind, string> = {
  HTML_CONTAINS: "HTML contains text",
  CSS_CONTAINS: "CSS contains text",
  JS_CONTAINS: "JavaScript contains text",
  HTML_SELECTOR: "HTML has element (selector)",
  FILE_REGEX: "File matches regex",
  DOM_BEHAVIOR: "DOM behavior (executes student JS)",
};

const DOM_ACTIONS: DomBehaviorAction[] = ["fill", "click", "select", "check", "wait"];
const DOM_CONDITIONS: DomBehaviorCondition[] = [
  "exists",
  "notExists",
  "textContains",
  "hasClass",
  "attributeEquals",
  "countEquals",
];

const emptyDomSpec = (): DomBehaviorSpec => ({
  steps: [{ action: "fill", selector: "", value: "" }],
  assert: { selector: "", condition: "exists", value: "" },
});

const emptyCase = (): Omit<PracticalTestCase, "id" | "examId" | "sortOrder"> => ({
  label: "",
  kind: "HTML_CONTAINS",
  targetFile: null,
  expression: "",
  points: 1,
  // Hidden by default — an admin must explicitly mark a test case public.
  isHidden: true,
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
  const [domSpec, setDomSpec] = useState<DomBehaviorSpec>(emptyDomSpec());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchPracticalTestCases(examId)
      .then(setCases)
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [examId]);

  useEffect(() => {
    load();
  }, [load]);

  function isDomSpecValid(spec: DomBehaviorSpec): boolean {
    if (spec.steps.length === 0) return false;
    for (const step of spec.steps) {
      if (step.action !== "wait" && !step.selector?.trim()) return false;
    }
    return Boolean(spec.assert.selector.trim());
  }

  async function addCase(e: React.FormEvent) {
    e.preventDefault();
    const isDom = draft.kind === "DOM_BEHAVIOR";
    if (!draft.label.trim()) return;
    if (isDom ? !isDomSpecValid(domSpec) : !draft.expression.trim()) return;
    setError(null);
    try {
      const payload = isDom ? { ...draft, expression: JSON.stringify(domSpec) } : draft;
      await createPracticalTestCase(examId, payload);
      setDraft(emptyCase());
      setDomSpec(emptyDomSpec());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-zaio-cloud bg-zaio-card shadow-xl">
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
                  <p className="font-medium text-zaio-ink">
                    {c.label}{" "}
                    <span
                      className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        c.isHidden ? "bg-zaio-ink/10 text-zaio-ink/60" : "bg-green-100 text-green-700"
                      }`}
                    >
                      {c.isHidden ? "Hidden" : "Public sample"}
                    </span>
                  </p>
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
            {draft.kind === "DOM_BEHAVIOR" ? (
              <div className="space-y-2 rounded-lg border border-zaio-cloud bg-white p-3">
                <p className="text-xs font-medium text-zaio-ink">Steps (executed in order)</p>
                {domSpec.steps.map((step, si) => (
                  <div key={si} className="flex items-center gap-1">
                    <select
                      className="input w-28 shrink-0"
                      value={step.action}
                      onChange={(e) => {
                        const next = [...domSpec.steps];
                        next[si] = { ...step, action: e.target.value as DomBehaviorAction };
                        setDomSpec({ ...domSpec, steps: next });
                      }}
                    >
                      {DOM_ACTIONS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                    {step.action !== "wait" ? (
                      <input
                        className="input flex-1"
                        placeholder="Selector (e.g. #email)"
                        value={step.selector ?? ""}
                        onChange={(e) => {
                          const next = [...domSpec.steps];
                          next[si] = { ...step, selector: e.target.value };
                          setDomSpec({ ...domSpec, steps: next });
                        }}
                      />
                    ) : null}
                    {step.action === "fill" || step.action === "select" ? (
                      <input
                        className="input flex-1"
                        placeholder="Value"
                        value={step.value ?? ""}
                        onChange={(e) => {
                          const next = [...domSpec.steps];
                          next[si] = { ...step, value: e.target.value };
                          setDomSpec({ ...domSpec, steps: next });
                        }}
                      />
                    ) : null}
                    {step.action === "wait" ? (
                      <input
                        type="number"
                        min={0}
                        className="input w-24"
                        placeholder="ms"
                        value={step.ms ?? 100}
                        onChange={(e) => {
                          const next = [...domSpec.steps];
                          next[si] = { ...step, ms: Number(e.target.value) };
                          setDomSpec({ ...domSpec, steps: next });
                        }}
                      />
                    ) : null}
                    <button
                      type="button"
                      className="text-xs text-red-600"
                      onClick={() => setDomSpec({ ...domSpec, steps: domSpec.steps.filter((_, i) => i !== si) })}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDomSpec({ ...domSpec, steps: [...domSpec.steps, { action: "fill", selector: "", value: "" }] })}
                >
                  Add step
                </Button>
                <p className="pt-2 text-xs font-medium text-zaio-ink">Assertion</p>
                <div className="flex items-center gap-1">
                  <input
                    className="input flex-1"
                    placeholder="Selector (e.g. .error)"
                    value={domSpec.assert.selector}
                    onChange={(e) => setDomSpec({ ...domSpec, assert: { ...domSpec.assert, selector: e.target.value } })}
                  />
                  <select
                    className="input w-36 shrink-0"
                    value={domSpec.assert.condition}
                    onChange={(e) =>
                      setDomSpec({ ...domSpec, assert: { ...domSpec.assert, condition: e.target.value as DomBehaviorCondition } })
                    }
                  >
                    {DOM_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input flex-1"
                    placeholder="Value (if applicable)"
                    value={domSpec.assert.value ?? ""}
                    onChange={(e) => setDomSpec({ ...domSpec, assert: { ...domSpec.assert, value: e.target.value } })}
                  />
                </div>
              </div>
            ) : (
              <input
                className="input"
                placeholder="Expression (text, selector, or regex)"
                value={draft.expression}
                onChange={(e) => setDraft({ ...draft, expression: e.target.value })}
              />
            )}
            <div className="flex items-center gap-4">
              <input
                type="number"
                min={1}
                className="input"
                value={draft.points}
                onChange={(e) => setDraft({ ...draft, points: Number(e.target.value) })}
              />
              <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={draft.isHidden}
                  onChange={(e) => setDraft({ ...draft, isHidden: e.target.checked })}
                />
                Hidden (private evaluation case)
              </label>
            </div>
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
