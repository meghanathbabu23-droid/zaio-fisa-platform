import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { loadMcqExam, startMcqExam, submitMcqExam } from "../../api";
import {
  bindProctoringExamMonitors,
  logProctoringEvent,
  uploadAndEndProctoring,
} from "../../student/proctoringHelpers";
import { Button } from "../../components/ui/Button";

export function McqExamPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [remaining, setRemaining] = useState(0);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [questions, setQuestions] = useState<{ id: string; prompt: string; options: string[] }[]>([]);
  const [answers, setAnswers] = useState<number[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [result, setResult] = useState<{ scorePercent: number; correct: number; total: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!assignmentId) return;
    setError(null);
    await startMcqExam(assignmentId);
    const exam = await loadMcqExam(assignmentId);
    setTitle(exam.title);
    setInstructions(exam.instructions);
    setQuestions(exam.questions);
    setRemaining(exam.remainingSeconds);
    setAnswers(exam.questions.map(() => -1));
    setCurrentIndex(0);
  }, [assignmentId]);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not start exam"));
    void logProctoringEvent("MCQ_LOADED", "MCQ exam interface loaded.");
    return bindProctoringExamMonitors();
  }, [load]);

  useEffect(() => {
    if (result) return;
    const t = window.setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, [result]);

  useEffect(() => {
    if (remaining === 0 && !result && questions.length > 0 && !submitting) {
      void doSubmit(true);
    }
  }, [remaining, result, questions.length, submitting]);

  async function doSubmit(force = false) {
    if (!assignmentId) return;
    const payload = answers;
    if (!force && payload.some((a) => a < 0)) {
      const firstUnanswered = payload.findIndex((a) => a < 0);
      if (firstUnanswered >= 0) setCurrentIndex(firstUnanswered);
      setError("Answer every question before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitMcqExam(assignmentId, payload);
      await uploadAndEndProctoring();
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  if (result) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <div className="rounded-2xl border border-zaio-cloud bg-white p-8 text-center shadow-sm">
          <p className="font-display text-2xl font-semibold text-zaio-ink">Exam submitted</p>
          <p className="mt-2 text-zaio-ink/70">
            Auto-marked: {result.correct}/{result.total} ({result.scorePercent.toFixed(0)}%)
          </p>
          <Link to="/student" className="mt-6 inline-block text-sm font-medium text-zaio-blue">
            Back to my exams
          </Link>
        </div>
      </div>
    );
  }

  const total = questions.length;
  const answeredCount = answers.filter((a) => a >= 0).length;
  const progressPct = total > 0 ? Math.round((answeredCount / total) * 100) : 0;
  const q = questions[currentIndex];
  const isLast = currentIndex === total - 1;

  return (
    <div className="min-h-screen bg-zaio-paper pb-12">
      <div className="sticky top-0 z-10 border-b border-zaio-cloud bg-white px-6 py-3 shadow-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <p className="font-display font-semibold text-zaio-ink">{title || "MCQ exam"}</p>
          <p
            className={`font-mono text-sm tabular-nums ${remaining < 120 ? "text-red-600" : "text-zaio-ink"}`}
          >
            {mins}:{secs.toString().padStart(2, "0")}
          </p>
        </div>
      </div>
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        {instructions ? (
          <div className="rounded-2xl border border-zaio-cloud bg-white p-5 text-sm text-zaio-ink/80 shadow-sm whitespace-pre-line">
            {instructions}
          </div>
        ) : null}

        {total > 0 ? (
          <div>
            <div className="flex items-center justify-between text-sm text-zaio-ink/70">
              <span>
                Question {currentIndex + 1} of {total}
              </span>
              <span>
                {answeredCount}/{total} answered
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zaio-ink/10">
              <div
                className="h-full rounded-full bg-zaio-blue transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {questions.map((qq, qi) => {
                const isCurrent = qi === currentIndex;
                const isAnswered = answers[qi] >= 0;
                return (
                  <button
                    key={qq.id}
                    type="button"
                    aria-label={`Go to question ${qi + 1}`}
                    aria-current={isCurrent}
                    onClick={() => setCurrentIndex(qi)}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                      isCurrent
                        ? "bg-zaio-blue text-white"
                        : isAnswered
                          ? "bg-zaio-blue/15 text-zaio-blue"
                          : "border border-zaio-ink/20 text-zaio-ink/60"
                    }`}
                  >
                    {qi + 1}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        {q ? (
          <fieldset
            key={q.id}
            className="rounded-2xl border border-zaio-cloud bg-white p-5 shadow-sm"
          >
            <legend className="font-medium text-zaio-ink">
              {currentIndex + 1}. {q.prompt}
            </legend>
            <div className="mt-3 space-y-2">
              {q.options.map((opt, oi) => (
                <label key={oi} className="flex cursor-pointer items-center gap-2 text-sm text-zaio-ink/80">
                  <input
                    type="radio"
                    name={q.id}
                    checked={answers[currentIndex] === oi}
                    onChange={() => {
                      const next = [...answers];
                      next[currentIndex] = oi;
                      setAnswers(next);
                    }}
                  />
                  {opt}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          >
            Previous
          </Button>
          {!isLast ? (
            <Button
              type="button"
              className="ml-auto"
              onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
            >
              Next
            </Button>
          ) : (
            <Button
              type="button"
              className="ml-auto"
              disabled={submitting || remaining === 0}
              onClick={() => void doSubmit(false)}
            >
              {submitting ? "Submitting…" : "Submit answers"}
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
