import { useCallback, useEffect, useState } from "react";
import {
  createPracticalQuestion,
  deletePracticalQuestion,
  deletePracticalQuestionReferenceAsset,
  fetchPracticalQuestionReferenceAssets,
  fetchPracticalQuestions,
  reorderPracticalQuestion,
  updatePracticalQuestion,
  uploadPracticalQuestionReferenceAsset,
} from "../api";
import type { Difficulty, PracticalQuestion, PracticalQuestionAssetInfo, PracticalQuestionInput } from "../types";
import { ModalShell } from "./ui/Modal/ModalShell";
import { Button } from "./ui/Button";
import { StateBanner } from "./ui/StateBanner";

const MAX_ASSET_BYTES = 20 * 1024 * 1024;

/** base = floor(total/count), remainder distributed one-each to the first
 * `remainder` questions — matches server/src/lib/mcqMarks.ts exactly (same
 * algorithm already duplicated client-side in ExamFormModal.tsx for MCQ). */
function autoDistributeMarks(questionCount: number, totalMarks: number): number[] {
  if (questionCount <= 0) return [];
  const base = Math.floor(totalMarks / questionCount);
  const remainder = totalMarks % questionCount;
  return Array.from({ length: questionCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

const emptyDraft = (): PracticalQuestionInput => ({
  title: "",
  scenario: "",
  instructions: "",
  requirements: [],
  marks: 0,
  difficulty: "MEDIUM",
});

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function QuestionAssets({ examId, questionId }: { examId: string; questionId: string }) {
  const [assets, setAssets] = useState<PracticalQuestionAssetInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(() => {
    fetchPracticalQuestionReferenceAssets(examId, questionId)
      .then(setAssets)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load assets"));
  }, [examId, questionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFile(file: File) {
    const name = file.name.toLowerCase();
    const looksSupported = name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || name.endsWith(".pdf");
    if (!looksSupported) {
      setError("Only .jpg, .jpeg, .png or .pdf files are supported.");
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      setError("File is too large.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const dataBase64 = await readFileAsBase64(file);
      await uploadPracticalQuestionReferenceAsset(examId, questionId, file.name, dataBase64);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-xs font-medium text-zaio-ink/70">Reference images / PDFs</p>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <ul className="space-y-1">
        {assets.map((a) => (
          <li key={a.filename} className="flex items-center justify-between text-xs">
            <a
              href={`/api/exams/${examId}/practical-questions/${questionId}/assets/${encodeURIComponent(a.filename)}`}
              target="_blank"
              rel="noreferrer"
              className="text-zaio-blue hover:underline"
            >
              {a.filename} ({(a.sizeBytes / 1024).toFixed(0)} KB)
            </a>
            <button
              type="button"
              className="text-red-600"
              onClick={async () => {
                await deletePracticalQuestionReferenceAsset(examId, questionId, a.filename);
                load();
              }}
            >
              Remove
            </button>
          </li>
        ))}
        {assets.length === 0 ? <li className="text-xs text-zaio-ink/40">No reference files yet.</li> : null}
      </ul>
      <label className="inline-block text-xs text-zaio-blue hover:underline">
        {uploading ? "Uploading…" : "+ Add file"}
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </label>
    </div>
  );
}

export function PracticalQuestionsModal({
  examId,
  examTitle,
  totalMarks,
  onClose,
}: {
  examId: string;
  examTitle: string;
  totalMarks: number | null;
  onClose: () => void;
}) {
  const [questions, setQuestions] = useState<PracticalQuestion[]>([]);
  const [draft, setDraft] = useState<PracticalQuestionInput>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const load = useCallback(() => {
    fetchPracticalQuestions(examId)
      .then((q) => {
        setQuestions(q);
        setLocked(false);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [examId]);

  useEffect(() => {
    load();
  }, [load]);

  const marksSum = questions.reduce((s, q) => s + q.marks, 0);
  const marksMatch = totalMarks != null && marksSum === totalMarks;

  function requirementsFromText(text: string): string[] {
    return text
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
  }

  async function applyAutoDistribute() {
    if (totalMarks == null || questions.length === 0) return;
    const distributed = autoDistributeMarks(questions.length, totalMarks);
    setError(null);
    try {
      await Promise.all(
        questions.map((q, i) =>
          updatePracticalQuestion(examId, q.id, {
            title: q.title,
            scenario: q.scenario,
            instructions: q.instructions,
            requirements: q.requirements,
            marks: distributed[i] ?? q.marks,
            difficulty: q.difficulty,
          })
        )
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auto-distribute failed");
      if (e instanceof Error && e.message.toLowerCase().includes("already has at least one student")) {
        setLocked(true);
      }
    }
  }

  function startEdit(q: PracticalQuestion) {
    setEditingId(q.id);
    setDraft({
      title: q.title,
      scenario: q.scenario,
      instructions: q.instructions,
      requirements: q.requirements,
      marks: q.marks,
      difficulty: q.difficulty,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft());
  }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    setError(null);
    try {
      if (editingId) {
        await updatePracticalQuestion(examId, editingId, draft);
      } else {
        await createPracticalQuestion(examId, draft);
      }
      cancelEdit();
      load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Save failed");
      if (e2 instanceof Error && e2.message.toLowerCase().includes("already has at least one student")) {
        setLocked(true);
      }
    }
  }

  async function removeQuestion(id: string) {
    if (!window.confirm("Delete this question? Its test cases become ungrouped, not deleted.")) return;
    setError(null);
    try {
      await deletePracticalQuestion(examId, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      if (e instanceof Error && e.message.toLowerCase().includes("already has at least one student")) {
        setLocked(true);
      }
    }
  }

  async function move(id: string, direction: "up" | "down") {
    setError(null);
    try {
      await reorderPracticalQuestion(examId, id, direction);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reorder failed");
      if (e instanceof Error && e.message.toLowerCase().includes("already has at least one student")) {
        setLocked(true);
      }
    }
  }

  return (
    <ModalShell title={`Questions — ${examTitle}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        {error ? <StateBanner tone="error">{error}</StateBanner> : null}
        {locked ? (
          <StateBanner tone="warning">
            This exam already has at least one student assignment — questions are locked. Archive it
            and create a new exam to make changes.
          </StateBanner>
        ) : null}
        {totalMarks != null ? (
          <div className="flex items-center justify-between rounded-lg bg-zaio-paper/80 px-3 py-2">
            <span className={`text-xs font-medium ${marksMatch ? "text-green-700" : "text-red-600"}`}>
              Marks: {marksSum} / {totalMarks}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => void applyAutoDistribute()}>
              Auto-distribute
            </Button>
          </div>
        ) : null}

        <ul className="space-y-3">
          {questions.map((q, i) => (
            <li key={q.id} className="rounded-lg border border-zaio-cloud p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-zaio-ink">
                    {q.title}{" "}
                    <span className="ml-1 rounded bg-zaio-ink/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zaio-ink/60">
                      {q.difficulty}
                    </span>
                  </p>
                  <p className="text-xs text-zaio-ink/50">
                    {q.marks} mark{q.marks === 1 ? "" : "s"} · {q.testCaseCount} test case
                    {q.testCaseCount === 1 ? "" : "s"}
                  </p>
                  {q.scenario ? <p className="mt-1 text-xs text-zaio-ink/70">{q.scenario}</p> : null}
                  <QuestionAssets examId={examId} questionId={q.id} />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                  <div className="flex gap-1">
                    <button type="button" disabled={i === 0} className="disabled:opacity-30" onClick={() => void move(q.id, "up")}>
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === questions.length - 1}
                      className="disabled:opacity-30"
                      onClick={() => void move(q.id, "down")}
                    >
                      ↓
                    </button>
                  </div>
                  <button type="button" className="text-zaio-blue" onClick={() => startEdit(q)}>
                    Edit
                  </button>
                  <button type="button" className="text-red-600" onClick={() => void removeQuestion(q.id)}>
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
          {questions.length === 0 ? <li className="text-sm text-zaio-ink/50">No questions yet.</li> : null}
        </ul>

        <form onSubmit={saveDraft} className="space-y-3 rounded-lg bg-zaio-paper/80 p-4">
          <p className="text-sm font-medium text-zaio-ink">{editingId ? "Edit question" : "Add question"}</p>
          <input
            className="input"
            placeholder="Title (e.g. Build a signup form)"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <textarea
            className="input min-h-[60px]"
            placeholder="Scenario"
            value={draft.scenario}
            onChange={(e) => setDraft({ ...draft, scenario: e.target.value })}
          />
          <textarea
            className="input min-h-[80px]"
            placeholder="Detailed instructions"
            value={draft.instructions}
            onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          />
          <textarea
            className="input min-h-[60px]"
            placeholder={"Requirements, one per line"}
            value={draft.requirements.join("\n")}
            onChange={(e) => setDraft({ ...draft, requirements: requirementsFromText(e.target.value) })}
          />
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              Marks
              <input
                type="number"
                min={0}
                className="input w-24"
                value={draft.marks}
                onChange={(e) => setDraft({ ...draft, marks: Number(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              Difficulty
              <select
                className="input"
                value={draft.difficulty}
                onChange={(e) => setDraft({ ...draft, difficulty: e.target.value as Difficulty })}
              >
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              {editingId ? "Save changes" : "Add question"}
            </Button>
            {editingId ? (
              <Button type="button" variant="secondary" size="sm" onClick={cancelEdit}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </ModalShell>
  );
}
