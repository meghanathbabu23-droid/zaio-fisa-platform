import { useCallback, useEffect, useState } from "react";
import {
  createCohort,
  deleteCohort,
  fetchCohorts,
  setCohortOtpEligibility,
  updateCohort,
} from "../api";
import { CohortFormModal } from "../components/CohortFormModal";
import { PageHeader } from "../components/PageHeader";
import type { Cohort, CohortInput } from "../types";
import { formatDate } from "../lib/dates";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { StateBanner } from "../components/ui/StateBanner";

const emptyForm: CohortInput = {
  name: "",
  programme: "",
  startDate: "",
  examDate: "",
  zoomLink: "",
};

export function CohortsPage() {
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Cohort | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchCohorts()
      .then(setCohorts)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load cohorts"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(cohort: Cohort) {
    setEditing(cohort);
    setModalOpen(true);
  }

  async function handleSave(data: CohortInput) {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateCohort(editing.id, data);
      } else {
        await createCohort(data);
      }
      setModalOpen(false);
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleOtpEligibility(cohort: Cohort) {
    const next = !cohort.realOtpEligible;
    if (
      next &&
      !window.confirm(
        `Mark "${cohort.name}" eligible for real email/SMS OTP delivery?\n\n` +
          "This only takes effect once the server is also globally switched to live delivery mode — but once both are true, every student in this cohort will receive real OTPs at their stored email/phone. " +
          "Confirm their contact details are real and reachable first."
      )
    ) {
      return;
    }
    setError(null);
    try {
      await setCohortOtpEligibility(cohort.id, next);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update OTP eligibility");
    }
  }

  async function handleDelete(cohort: Cohort) {
    if (!window.confirm(`Delete cohort "${cohort.name}"? This cannot be undone.`)) {
      return;
    }
    setError(null);
    try {
      await deleteCohort(cohort.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <>
      <PageHeader
        title="Cohorts"
        description="Create and manage examination cohorts."
        action={
          <Button type="button" onClick={openCreate}>
            New cohort
          </Button>
        }
      />
      <div className="flex-1 p-8">
        {error ? (
          <StateBanner tone="error" className="mb-4">
            {error}
          </StateBanner>
        ) : null}
        <div className="overflow-hidden rounded-2xl border border-zaio-cloud bg-zaio-card shadow-sm">
          <h2 className="sr-only">Cohort list</h2>
          {loading ? (
            <p className="px-6 py-10 text-sm text-zaio-ink/50">Loading cohorts…</p>
          ) : cohorts.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zaio-ink/60">
              No cohorts yet. Click <strong>New cohort</strong> to add one.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-zaio-cloud bg-zaio-paper/80 text-xs font-medium uppercase tracking-wide text-zaio-ink/50">
                  <tr>
                    <th className="px-6 py-3">Name</th>
                    <th className="px-6 py-3">Programme</th>
                    <th className="px-6 py-3">Start</th>
                    <th className="px-6 py-3">Exam</th>
                    <th className="px-6 py-3">Zoom</th>
                    <th className="px-6 py-3">Real OTP delivery</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zaio-cloud">
                  {cohorts.map((c) => (
                    <tr key={c.id} className="hover:bg-zaio-paper/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-zaio-ink">{c.name}</td>
                      <td className="px-6 py-4 text-zaio-ink/70">{c.programme}</td>
                      <td className="px-6 py-4 text-zaio-ink/70">{formatDate(c.startDate)}</td>
                      <td className="px-6 py-4 text-zaio-ink/70">{formatDate(c.examDate)}</td>
                      <td className="max-w-[200px] truncate px-6 py-4">
                        <a
                          href={c.zoomLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-zaio-blue hover:underline"
                        >
                          Link
                        </a>
                      </td>
                      <td className="px-6 py-4">
                        <button type="button" onClick={() => void handleToggleOtpEligibility(c)}>
                          <Badge tone={c.realOtpEligible ? "success" : "neutral"}>
                            {c.realOtpEligible ? "Eligible" : "Mock only"}
                          </Badge>
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="mr-3 font-medium text-zaio-blue hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(c)}
                          className="font-medium text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {modalOpen ? (
        <CohortFormModal
          initial={
            editing
              ? {
                  name: editing.name,
                  programme: editing.programme,
                  startDate: editing.startDate,
                  examDate: editing.examDate,
                  zoomLink: editing.zoomLink,
                }
              : emptyForm
          }
          title={editing ? "Edit cohort" : "New cohort"}
          saving={saving}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      ) : null}
    </>
  );
}
