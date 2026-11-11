import { useState } from "react";
import type { Cohort, StudentInput } from "../types";
import { ModalShell } from "./ui/Modal/ModalShell";
import { Field } from "./ui/Modal/Field";
import { ModalActions } from "./ui/Modal/ModalActions";
import { StateBanner } from "./ui/StateBanner";

export function StudentFormModal({
  title,
  cohorts,
  initial,
  saving,
  onClose,
  onSave,
}: {
  title: string;
  cohorts: Cohort[];
  initial: StudentInput;
  saving: boolean;
  onClose: () => void;
  onSave: (data: StudentInput) => void;
}) {
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [email, setEmail] = useState(initial.email);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [cohortId, setCohortId] = useState(initial.cohortId);
  const [validation, setValidation] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !cohortId) {
      setValidation("First name, last name, email and cohort are required.");
      return;
    }
    setValidation(null);
    onSave({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim() ? phone.trim() : null,
      cohortId,
    });
  }

  return (
    <ModalShell title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {validation ? <StateBanner tone="info">{validation}</StateBanner> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label="Last name">
            <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>
        <Field label="Zaio email">
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@zaio.io"
          />
        </Field>
        <Field label="Phone (optional)">
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+27..."
          />
        </Field>
        <Field label="Cohort">
          <select className="input" value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
            <option value="">Select cohort</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <ModalActions saving={saving} onClose={onClose} saveLabel="Save student" />
      </form>
    </ModalShell>
  );
}
