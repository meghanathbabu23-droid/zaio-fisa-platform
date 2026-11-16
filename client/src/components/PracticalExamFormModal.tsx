import { useState } from "react";
import {
  createPracticalExam,
  createPracticalQuestion,
  deleteExam,
  uploadPracticalQuestionReferenceAsset,
} from "../api";
import type { Cohort, Difficulty, PracticalQuestionInput } from "../types";
import { ModalShell } from "./ui/Modal/ModalShell";
import { ModalActions } from "./ui/Modal/ModalActions";
import { StateBanner } from "./ui/StateBanner";
import { Button } from "./ui/Button";
import { autoDistributeMarks, emptyDraft, MAX_ASSET_BYTES, readFileAsBase64 } from "./PracticalQuestionsModal";

export type PracticalExamInput = {
  title: string;
  durationMinutes: number;
  instructions: string;
  cohortId: string | null;
  totalMarks: number;
};

/** A question not yet persisted anywhere — collected locally while the exam
 * itself doesn't exist yet, so it can't have a real id or a real
 * practical-questions/:id/assets endpoint to upload files to. Reference
 * files are staged as plain File objects and only actually uploaded once
 * the question (and the asset endpoint it needs) exists — see submit(). */
type QuestionDraft = PracticalQuestionInput & { localId: string; stagedFiles: File[] };

let localIdCounter = 0;
function newLocalId(): string {
  localIdCounter += 1;
  return `draft-${Date.now()}-${localIdCounter}`;
}

export function PracticalExamFormModal({
  cohorts,
  onClose,
  onSaved,
}: {
  cohorts: Cohort[];
  onClose: () => void;
  /** Called once the exam (and, if any, its questions) are fully saved.
   * `warning` is set when the exam and all questions saved but one or more
   * optional reference files failed to upload — never when the exam or a
   * question itself failed (that case rolls back and keeps the modal open
   * instead, so nothing incomplete is ever silently left behind). */
  onSaved: (warning: string | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [instructions, setInstructions] = useState(
    "Build the required page using HTML, CSS and JavaScript. Work autosaves. Submit when finished."
  );
  const [cohortId, setCohortId] = useState<string>("");
  const [totalMarks, setTotalMarks] = useState(100);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [validation, setValidation] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const marksSum = questions.reduce((s, q) => s + (Number.isFinite(q.marks) ? q.marks : 0), 0);
  const marksMatch = questions.length === 0 || marksSum === totalMarks;

  function addQuestion() {
    setQuestions([...questions, { ...emptyDraft(), localId: newLocalId(), stagedFiles: [] }]);
  }

  function updateQuestion(localId: string, patch: Partial<QuestionDraft>) {
    setQuestions(questions.map((q) => (q.localId === localId ? { ...q, ...patch } : q)));
  }

  function removeQuestion(localId: string) {
    setQuestions(questions.filter((q) => q.localId !== localId));
  }

  function applyAutoDistribute() {
    const distributed = autoDistributeMarks(questions.length, totalMarks);
    setQuestions(questions.map((q, i) => ({ ...q, marks: distributed[i] ?? q.marks })));
  }

  function addStagedFile(localId: string, file: File) {
    const name = file.name.toLowerCase();
    const looksSupported = [".jpg", ".jpeg", ".png", ".pdf"].some((ext) => name.endsWith(ext));
    if (!looksSupported) {
      setValidation("Only .jpg, .jpeg, .png or .pdf reference files are supported.");
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      setValidation("A reference file is too large.");
      return;
    }
    setValidation(null);
    setQuestions(
      questions.map((q) => (q.localId === localId ? { ...q, stagedFiles: [...q.stagedFiles, file] } : q))
    );
  }

  function removeStagedFile(localId: string, fileIndex: number) {
    setQuestions(
      questions.map((q) =>
        q.localId === localId ? { ...q, stagedFiles: q.stagedFiles.filter((_, i) => i !== fileIndex) } : q
      )
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || totalMarks < 1) {
      setValidation("Title and total marks are required.");
      return;
    }
    if (questions.length > 0) {
      if (questions.some((q) => !q.title.trim())) {
        setValidation("Every question needs a title.");
        return;
      }
      if (questions.some((q) => !Number.isInteger(q.marks) || q.marks < 0)) {
        setValidation("Every question's marks must be a non-negative whole number.");
        return;
      }
      if (!marksMatch) {
        setValidation(
          `Question marks sum to ${marksSum}, but total marks is ${totalMarks}. Use "Auto-distribute" or adjust manually.`
        );
        return;
      }
    }
    setValidation(null);
    setSaving(true);

    // Create exam -> create each question -> upload any staged reference
    // files, in that order. A failure creating the exam or ANY question
    // rolls the whole thing back (deletes the exam, which cascades its
    // already-created questions) so a half-written exam is never left
    // behind silently — the admin either gets a complete exam+questions or
    // nothing at all. A failure uploading an optional reference file does
    // NOT roll back anything (the exam and its questions are already
    // valid, graded content without it) — it's reported as a warning
    // instead, after a successful save.
    let examId: string | null = null;
    try {
      const exam = await createPracticalExam({
        title: title.trim(),
        durationMinutes,
        instructions: instructions.trim(),
        cohortId: cohortId || null,
        totalMarks,
      });
      examId = exam.id;

      const createdQuestionIds: string[] = [];
      for (const q of questions) {
        const created = await createPracticalQuestion(examId, {
          title: q.title.trim(),
          scenario: q.scenario,
          instructions: q.instructions,
          requirements: q.requirements,
          marks: q.marks,
          difficulty: q.difficulty,
        });
        createdQuestionIds.push(created.id);
      }

      const assetFailures: string[] = [];
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i]!;
        const questionId = createdQuestionIds[i]!;
        for (const file of q.stagedFiles) {
          try {
            const dataBase64 = await readFileAsBase64(file);
            await uploadPracticalQuestionReferenceAsset(examId, questionId, file.name, dataBase64);
          } catch (err) {
            assetFailures.push(
              `${q.title.trim() || "Question"} — ${file.name}: ${err instanceof Error ? err.message : "upload failed"}`
            );
          }
        }
      }

      onSaved(
        assetFailures.length > 0
          ? `Exam and questions saved, but some reference files failed to upload — add them from "Questions" instead: ${assetFailures.join("; ")}`
          : null
      );
    } catch (err) {
      if (examId) {
        try {
          await deleteExam(examId);
          setValidation("Could not save all questions — nothing was kept. The exam was rolled back; please try again.");
        } catch {
          setValidation(
            "Could not save all questions, and the automatic rollback also failed. An incomplete exam may exist — " +
              "please check the Exams list and remove it manually before retrying."
          );
        }
      } else {
        setValidation(err instanceof Error ? err.message : "Could not create the exam.");
      }
      setSaving(false);
    }
  }

  return (
    <ModalShell title="New practical exam" onClose={onClose} size="lg">
      <form onSubmit={submit} className="space-y-4">
        {validation ? <StateBanner tone="info">{validation}</StateBanner> : null}
        <label className="block text-sm">
          Title
          <input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            Duration (minutes)
            <input
              type="number"
              min={15}
              className="input mt-1"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
            />
          </label>
          <label className="block text-sm">
            Total marks
            <input
              type="number"
              min={1}
              className="input mt-1"
              value={totalMarks}
              onChange={(e) => setTotalMarks(Number(e.target.value))}
            />
          </label>
          <label className="block text-sm">
            Cohort (optional)
            <select className="input mt-1" value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
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
          Instructions
          <textarea
            className="input mt-1 min-h-[80px]"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        <p className="text-xs text-zaio-ink/50">
          Learners receive a multi-file workspace (HTML, CSS, JS) with live preview.
        </p>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-zaio-ink">
              Practical questions (optional)
            </h3>
            <div className="flex items-center gap-2">
              {questions.length > 0 ? (
                <span className={`text-xs font-medium ${marksMatch ? "text-green-700" : "text-red-600"}`}>
                  Marks: {marksSum} / {totalMarks}
                </span>
              ) : null}
              {questions.length > 0 ? (
                <Button type="button" variant="ghost" onClick={applyAutoDistribute}>
                  Auto-distribute
                </Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={addQuestion}>
                Add question
              </Button>
            </div>
          </div>
          <p className="text-xs text-zaio-ink/50">
            Add one or more coding questions now, or leave this empty and add them later from "Questions" on
            the exams list.
          </p>

          {questions.map((q, qi) => (
            <div key={q.localId} className="space-y-2 rounded-lg border border-zaio-cloud bg-zaio-paper/50 p-4">
              <div className="flex items-center gap-2">
                <input
                  className="input flex-1"
                  placeholder={`Question ${qi + 1} title (e.g. Build a signup form)`}
                  value={q.title}
                  onChange={(e) => updateQuestion(q.localId, { title: e.target.value })}
                />
                <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                  Marks
                  <input
                    type="number"
                    min={0}
                    className="input w-20"
                    value={q.marks}
                    onChange={(e) => updateQuestion(q.localId, { marks: Number(e.target.value) })}
                  />
                </label>
                <select
                  className="input w-28 shrink-0"
                  value={q.difficulty}
                  onChange={(e) => updateQuestion(q.localId, { difficulty: e.target.value as Difficulty })}
                >
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </select>
                <button type="button" className="text-xs text-red-600" onClick={() => removeQuestion(q.localId)}>
                  Remove
                </button>
              </div>
              <textarea
                className="input min-h-[50px]"
                placeholder="Scenario"
                value={q.scenario}
                onChange={(e) => updateQuestion(q.localId, { scenario: e.target.value })}
              />
              <textarea
                className="input min-h-[70px]"
                placeholder="Detailed instructions"
                value={q.instructions}
                onChange={(e) => updateQuestion(q.localId, { instructions: e.target.value })}
              />
              <textarea
                className="input min-h-[50px]"
                placeholder="Requirements, one per line"
                value={q.requirements.join("\n")}
                onChange={(e) =>
                  updateQuestion(q.localId, {
                    requirements: e.target.value
                      .split("\n")
                      .map((r) => r.trim())
                      .filter(Boolean),
                  })
                }
              />
              <div className="space-y-1">
                <p className="text-xs font-medium text-zaio-ink/70">Reference images / PDFs</p>
                <ul className="space-y-1">
                  {q.stagedFiles.map((file, fi) => (
                    <li key={fi} className="flex items-center justify-between text-xs">
                      <span>
                        {file.name} ({(file.size / 1024).toFixed(0)} KB)
                      </span>
                      <button type="button" className="text-red-600" onClick={() => removeStagedFile(q.localId, fi)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <label className="inline-block text-xs text-zaio-blue hover:underline">
                  + Add file
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) addStagedFile(q.localId, file);
                    }}
                  />
                </label>
              </div>
            </div>
          ))}
        </section>

        <ModalActions saving={saving} onClose={onClose} saveLabel="Create exam" />
      </form>
    </ModalShell>
  );
}
