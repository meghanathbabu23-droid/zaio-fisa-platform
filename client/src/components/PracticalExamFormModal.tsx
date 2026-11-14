import { useState } from "react";
import type { Cohort } from "../types";
import { ModalShell } from "./ui/Modal/ModalShell";
import { ModalActions } from "./ui/Modal/ModalActions";

export type PracticalExamInput = {
  title: string;
  durationMinutes: number;
  instructions: string;
  cohortId: string | null;
  totalMarks: number;
};

export function PracticalExamFormModal({
  cohorts,
  saving,
  onClose,
  onSave,
}: {
  cohorts: Cohort[];
  saving: boolean;
  onClose: () => void;
  onSave: (data: PracticalExamInput) => void;
}) {
  const [title, setTitle] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [instructions, setInstructions] = useState(
    "Build the required page using HTML, CSS and JavaScript. Work autosaves. Submit when finished."
  );
  const [cohortId, setCohortId] = useState<string>("");
  const [totalMarks, setTotalMarks] = useState(100);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || totalMarks < 1) return;
    onSave({
      title: title.trim(),
      durationMinutes,
      instructions: instructions.trim(),
      cohortId: cohortId || null,
      totalMarks,
    });
  }

  return (
    <ModalShell title="New practical exam" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm">
            Title
            <input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
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
          <ModalActions saving={saving} onClose={onClose} saveLabel="Create exam" />
      </form>
    </ModalShell>
  );
}
