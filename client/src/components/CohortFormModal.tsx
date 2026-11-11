import { useState } from "react";
import type { CohortInput } from "../types";
import { toInputDate } from "../lib/dates";
import { ModalShell } from "./ui/Modal/ModalShell";
import { Field } from "./ui/Modal/Field";
import { ModalActions } from "./ui/Modal/ModalActions";
import { StateBanner } from "./ui/StateBanner";

export function CohortFormModal({
  title,
  initial,
  saving,
  onClose,
  onSave,
}: {
  title: string;
  initial: CohortInput;
  saving: boolean;
  onClose: () => void;
  onSave: (data: CohortInput) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [programme, setProgramme] = useState(initial.programme);
  const [startDate, setStartDate] = useState(
    initial.startDate ? toInputDate(initial.startDate) : ""
  );
  const [examDate, setExamDate] = useState(
    initial.examDate ? toInputDate(initial.examDate) : ""
  );
  const [zoomLink, setZoomLink] = useState(initial.zoomLink);
  const [validation, setValidation] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !programme.trim() || !startDate || !examDate || !zoomLink.trim()) {
      setValidation("All fields are required.");
      return;
    }
    const start = new Date(startDate);
    const exam = new Date(examDate);
    if (exam < start) {
      setValidation("Exam date must be on or after the start date.");
      return;
    }
    setValidation(null);
    onSave({
      name: name.trim(),
      programme: programme.trim(),
      startDate: start.toISOString(),
      examDate: exam.toISOString(),
      zoomLink: zoomLink.trim(),
    });
  }

  return (
    <ModalShell title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {validation ? <StateBanner tone="info">{validation}</StateBanner> : null}
        <Field label="Cohort name">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. FISA 2026-A"
            />
          </Field>
          <Field label="Programme">
            <input
              className="input"
              value={programme}
              onChange={(e) => setProgramme(e.target.value)}
              placeholder="e.g. HTML Programmer Skills (SP-230372)"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date">
              <input
                type="date"
                className="input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            <Field label="Exam date">
              <input
                type="date"
                className="input"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Zoom link">
            <input
              type="url"
              className="input"
              value={zoomLink}
              onChange={(e) => setZoomLink(e.target.value)}
              placeholder="https://zoom.us/j/..."
            />
          </Field>
        <ModalActions saving={saving} onClose={onClose} saveLabel="Save cohort" />
      </form>
    </ModalShell>
  );
}
