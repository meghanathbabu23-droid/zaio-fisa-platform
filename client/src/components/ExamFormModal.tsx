import { useState } from "react";
import type { Cohort, ExamInput, McqQuestionInput } from "../types";
import { ModalShell } from "./ui/Modal/ModalShell";
import { ModalActions } from "./ui/Modal/ModalActions";
import { StateBanner } from "./ui/StateBanner";
import { Button } from "./ui/Button";

const defaultQuestions: McqQuestionInput[] = [
  {
    prompt: "Which HTML element defines the main heading of a page?",
    options: ["<p>", "<h1>", "<head>", "<title>"],
    correctIndex: 1,
  },
  {
    prompt: "Which property sets the background colour in CSS?",
    options: ["color", "font-size", "background-color", "margin"],
    correctIndex: 2,
  },
];

export function ExamFormModal({
  title,
  cohorts,
  initial,
  saving,
  onClose,
  onSave,
}: {
  title: string;
  cohorts: Cohort[];
  initial: ExamInput;
  saving: boolean;
  onClose: () => void;
  onSave: (data: ExamInput) => void;
}) {
  const [form, setForm] = useState(initial);
  const [questions, setQuestions] = useState<McqQuestionInput[]>(
    initial.questions.length ? initial.questions : defaultQuestions
  );
  const [validation, setValidation] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || form.durationMinutes < 1) {
      setValidation("Title and duration are required.");
      return;
    }
    if (questions.some((q) => !q.prompt.trim() || q.options.filter(Boolean).length < 2)) {
      setValidation("Each question needs a prompt and at least two options.");
      return;
    }
    setValidation(null);
    onSave({
      ...form,
      title: form.title.trim(),
      instructions: form.instructions.trim(),
      cohortId: form.cohortId || null,
      questions: questions.map((q) => ({
        prompt: q.prompt.trim(),
        options: q.options.map((o) => o.trim()).filter(Boolean),
        correctIndex: q.correctIndex,
      })),
    });
  }

  return (
    <ModalShell title={title} onClose={onClose} size="lg">
      <form onSubmit={submit} className="space-y-4">
        {validation ? <StateBanner tone="info">{validation}</StateBanner> : null}
        <label className="block text-sm">
            <span className="font-medium">Exam title</span>
            <input
              className="input mt-1"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">Duration (minutes)</span>
              <input
                type="number"
                min={1}
                className="input mt-1"
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Cohort (optional)</span>
              <select
                className="input mt-1"
                value={form.cohortId ?? ""}
                onChange={(e) => setForm({ ...form, cohortId: e.target.value || null })}
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
          <label className="block text-sm">
            <span className="font-medium">Instructions</span>
            <textarea
              className="input mt-1 min-h-[72px]"
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            />
          </label>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-zaio-ink">MCQ questions</h3>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setQuestions([
                    ...questions,
                    { prompt: "", options: ["", "", "", ""], correctIndex: 0 },
                  ])
                }
              >
                Add question
              </Button>
            </div>
            {questions.map((q, qi) => (
              <div key={qi} className="rounded-lg border border-zaio-cloud bg-zaio-paper/50 p-4">
                <input
                  className="input mb-2"
                  placeholder={`Question ${qi + 1}`}
                  value={q.prompt}
                  onChange={(e) => {
                    const next = [...questions];
                    next[qi] = { ...q, prompt: e.target.value };
                    setQuestions(next);
                  }}
                />
                {q.options.map((opt, oi) => (
                  <div key={oi} className="mb-1 flex items-center gap-2">
                    <input
                      type="radio"
                      name={`correct-${qi}`}
                      checked={q.correctIndex === oi}
                      onChange={() => {
                        const next = [...questions];
                        next[qi] = { ...q, correctIndex: oi };
                        setQuestions(next);
                      }}
                    />
                    <input
                      className="input flex-1"
                      placeholder={`Option ${oi + 1}`}
                      value={opt}
                      onChange={(e) => {
                        const next = [...questions];
                        const opts = [...q.options];
                        opts[oi] = e.target.value;
                        next[qi] = { ...q, options: opts };
                        setQuestions(next);
                      }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </section>
          <ModalActions saving={saving} onClose={onClose} saveLabel="Save exam" />
        </form>
    </ModalShell>
  );
}
