import { useState } from "react";
import { generateExamQuestions } from "../api";
import type { Cohort, DifficultySplit, ExamType, GenerationOutcome, GenerationUnresolvedSlot } from "../types";
import { ModalShell } from "./ui/Modal/ModalShell";
import { StateBanner } from "./ui/StateBanner";
import { Button } from "./ui/Button";

type FormState = {
  examType: ExamType;
  qualification: string;
  title: string;
  topics: string[];
  topicDraft: string;
  count: number;
  difficulty: DifficultySplit;
  totalMarks: number;
  durationMinutes: number;
  cohortId: string;
  publicWeightPct: number; // 0-100, converted to a 0-1 fraction on submit
};

const initialForm: FormState = {
  examType: "MCQ",
  qualification: "",
  title: "",
  topics: [],
  topicDraft: "",
  count: 5,
  difficulty: { EASY: 40, MEDIUM: 40, HARD: 20 },
  totalMarks: 100,
  durationMinutes: 45,
  cohortId: "",
  publicWeightPct: 30,
};

function errorMessageFor(outcome: Extract<GenerationOutcome, { kind: Exclude<GenerationOutcome["kind"], "success"> }>): string {
  switch (outcome.kind) {
    case "not_configured":
      return "AI generation is not configured on the server (missing API keys). Ask an administrator to set this up before trying again.";
    case "locked":
      return "A generation job is already running for your account. Wait for it to finish before starting another.";
    case "insufficient_uniqueness":
      return "Could not generate enough genuinely unique questions for every slot — nothing was saved. See the unresolved topics/difficulties below.";
    case "invalid":
      return outcome.error;
    case "server_error":
    default:
      return outcome.error || "Generation failed due to an internal error.";
  }
}

export function GenerateExamModal({
  cohorts,
  onClose,
  onGenerated,
}: {
  cohorts: Cohort[];
  onClose: () => void;
  onGenerated: () => void;
}) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [validation, setValidation] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorOutcome, setErrorOutcome] = useState<
    Extract<GenerationOutcome, { kind: Exclude<GenerationOutcome["kind"], "success"> }> | null
  >(null);
  const [result, setResult] = useState<
    Extract<GenerationOutcome, { kind: "success" }> | null
  >(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const difficultySum = form.difficulty.EASY + form.difficulty.MEDIUM + form.difficulty.HARD;

  function addTopic() {
    const t = form.topicDraft.trim();
    if (!t || form.topics.includes(t)) return;
    setForm({ ...form, topics: [...form.topics, t], topicDraft: "" });
  }

  function removeTopic(t: string) {
    setForm({ ...form, topics: form.topics.filter((x) => x !== t) });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // guards a double-click/double-submit in addition to the server's own lock
    if (!form.qualification.trim() || !form.title.trim()) {
      setValidation("Qualification/course and exam title are required.");
      return;
    }
    if (form.topics.length === 0) {
      setValidation("Add at least one topic.");
      return;
    }
    if (!Number.isInteger(form.count) || form.count < 1) {
      setValidation("Number of questions must be a positive whole number.");
      return;
    }
    if (difficultySum !== 100) {
      setValidation(`Difficulty percentages must sum to 100 (currently ${difficultySum}).`);
      return;
    }
    if (!Number.isInteger(form.totalMarks) || form.totalMarks < 1) {
      setValidation("Total marks must be a positive whole number.");
      return;
    }
    if (!Number.isInteger(form.durationMinutes) || form.durationMinutes < 1) {
      setValidation("Duration must be a positive whole number of minutes.");
      return;
    }
    setValidation(null);
    setErrorOutcome(null);
    setSubmitting(true);
    try {
      const outcome = await generateExamQuestions({
        type: form.examType,
        title: `${form.qualification.trim()} — ${form.title.trim()}`,
        topics: form.topics,
        count: form.count,
        difficulty: form.difficulty,
        totalMarks: form.totalMarks,
        durationMinutes: form.durationMinutes,
        cohortId: form.cohortId || null,
        ...(form.examType === "PRACTICAL" ? { publicWeightPct: form.publicWeightPct / 100 } : {}),
      });
      if (outcome.kind === "success") {
        setResult(outcome);
      } else {
        setErrorOutcome(outcome);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <ModalShell title="Exam generated" onClose={onClose} size="lg">
        <div className="space-y-4">
          <StateBanner tone="success">
            Generated and saved <strong>{result.exam.title}</strong> — it is currently <strong>not active</strong> (not
            assignable to students yet). Review the questions below, then find it under the "Archived" tab on the
            Exams page and click "Restore" when you're ready to assign it.
          </StateBanner>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase text-zaio-ink/50">Type</dt>
              <dd className="font-medium">{result.exam.type}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-zaio-ink/50">Total marks</dt>
              <dd className="font-medium">{result.exam.totalMarks}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-zaio-ink/50">Duration</dt>
              <dd className="font-medium">{result.exam.durationMinutes} min</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-zaio-ink/50">
                {result.exam.type === "PRACTICAL" ? "Test cases" : "Questions"}
              </dt>
              <dd className="font-medium">
                {result.exam.type === "PRACTICAL" ? result.exam.practicalTests?.length ?? 0 : result.exam.questions?.length ?? 0}
              </dd>
            </div>
          </dl>
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-zaio-ink/50">Topic coverage</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(result.topicCoverage).map(([topic, count]) => (
                <span key={topic} className="rounded-full bg-zaio-mist px-3 py-1 text-xs">
                  {topic}: {count}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-zaio-ink/50">Difficulty distribution</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(result.difficultyDistribution).map(([difficulty, count]) => (
                <span key={difficulty} className="rounded-full bg-zaio-mist px-3 py-1 text-xs">
                  {difficulty}: {count}
                </span>
              ))}
            </div>
          </div>
          <div>
            <Button type="button" variant="ghost" onClick={() => setReviewOpen(!reviewOpen)}>
              {reviewOpen ? "Hide" : "Review"} generated questions
            </Button>
            {reviewOpen ? (
              <div className="mt-2 max-h-72 space-y-3 overflow-y-auto rounded-lg border border-zaio-cloud p-3">
                {result.exam.type === "MCQ"
                  ? result.exam.questions?.map((q) => (
                      <div key={q.id} className="text-sm">
                        <p className="font-medium">
                          {q.prompt} <span className="text-xs text-zaio-ink/50">({q.marks} marks)</span>
                        </p>
                        <ul className="ml-4 list-disc text-xs text-zaio-ink/70">
                          {q.options.map((opt, i) => (
                            <li key={i} className={i === q.correctIndex ? "font-semibold text-emerald-700" : ""}>
                              {opt} {i === q.correctIndex ? "(correct)" : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  : result.exam.practicalTests?.map((t) => (
                      <div key={t.id} className="text-sm">
                        <p className="font-medium">
                          {t.label}{" "}
                          <span
                            className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                              t.isHidden ? "bg-zaio-ink/10 text-zaio-ink/60" : "bg-green-100 text-green-700"
                            }`}
                          >
                            {t.isHidden ? "Hidden" : "Public sample"}
                          </span>
                        </p>
                        <p className="text-xs text-zaio-ink/50">
                          {t.kind} · {t.points} pt{t.points > 1 ? "s" : ""}
                        </p>
                      </div>
                    ))}
              </div>
            ) : null}
          </div>
          <div className="flex justify-end border-t border-zaio-cloud pt-4">
            <Button
              type="button"
              onClick={() => {
                onGenerated();
                onClose();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Generate exam with AI" onClose={onClose} size="lg">
      <form onSubmit={submit} className="space-y-4">
        {validation ? <StateBanner tone="info">{validation}</StateBanner> : null}
        {errorOutcome ? (
          <StateBanner tone="error">
            {errorMessageFor(errorOutcome)}
            {errorOutcome.kind === "insufficient_uniqueness" && errorOutcome.unresolvedSlots.length > 0 ? (
              <ul className="mt-2 list-disc pl-4 text-xs">
                {errorOutcome.unresolvedSlots.map((slot: GenerationUnresolvedSlot, i: number) => (
                  <li key={i}>
                    {slot.topic} ({slot.difficulty})
                  </li>
                ))}
              </ul>
            ) : null}
          </StateBanner>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Exam type</span>
            <select
              className="input mt-1"
              value={form.examType}
              onChange={(e) => setForm({ ...form, examType: e.target.value as ExamType })}
              disabled={submitting}
            >
              <option value="MCQ">MCQ</option>
              <option value="PRACTICAL">Practical coding</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium">Cohort (optional)</span>
            <select
              className="input mt-1"
              value={form.cohortId}
              onChange={(e) => setForm({ ...form, cohortId: e.target.value })}
              disabled={submitting}
            >
              <option value="">Any</option>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Qualification / course</span>
            <input
              className="input mt-1"
              placeholder="e.g. FISA HTML Programmer (SP-230372)"
              value={form.qualification}
              onChange={(e) => setForm({ ...form, qualification: e.target.value })}
              disabled={submitting}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Exam title</span>
            <input
              className="input mt-1"
              placeholder="e.g. Mock Assessment 3"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              disabled={submitting}
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="font-medium">Topics</span>
          <div className="mt-1 flex gap-2">
            <input
              className="input flex-1"
              placeholder="Add a topic and press Enter"
              value={form.topicDraft}
              onChange={(e) => setForm({ ...form, topicDraft: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTopic();
                }
              }}
              disabled={submitting}
            />
            <Button type="button" variant="secondary" onClick={addTopic} disabled={submitting}>
              Add
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {form.topics.map((t) => (
              <span key={t} className="flex items-center gap-1 rounded-full bg-zaio-mist px-3 py-1 text-xs">
                {t}
                <button type="button" onClick={() => removeTopic(t)} disabled={submitting} className="text-zaio-ink/50">
                  ✕
                </button>
              </span>
            ))}
            {form.topics.length === 0 ? <span className="text-xs text-zaio-ink/40">No topics added yet.</span> : null}
          </div>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">{form.examType === "PRACTICAL" ? "Number of coding questions" : "Number of MCQs"}</span>
            <input
              type="number"
              min={1}
              className="input mt-1"
              value={form.count}
              onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}
              disabled={submitting}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Total marks</span>
            <input
              type="number"
              min={1}
              className="input mt-1"
              value={form.totalMarks}
              onChange={(e) => setForm({ ...form, totalMarks: Number(e.target.value) })}
              disabled={submitting}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Duration (minutes)</span>
            <input
              type="number"
              min={1}
              className="input mt-1"
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
              disabled={submitting}
            />
          </label>
          {form.examType === "PRACTICAL" ? (
            <label className="block text-sm">
              <span className="font-medium">Public sample test weight (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                className="input mt-1"
                value={form.publicWeightPct}
                onChange={(e) => setForm({ ...form, publicWeightPct: Number(e.target.value) })}
                disabled={submitting}
              />
            </label>
          ) : null}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Difficulty distribution (%)</span>
            <span className={`text-xs font-medium ${difficultySum === 100 ? "text-green-700" : "text-red-600"}`}>
              Sum: {difficultySum} / 100
            </span>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {(["EASY", "MEDIUM", "HARD"] as const).map((level) => (
              <label key={level} className="block text-xs">
                {level}
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input mt-1"
                  value={form.difficulty[level]}
                  onChange={(e) =>
                    setForm({ ...form, difficulty: { ...form.difficulty, [level]: Number(e.target.value) } })
                  }
                  disabled={submitting}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-zaio-cloud pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Generating… this can take a minute" : "Generate exam"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
