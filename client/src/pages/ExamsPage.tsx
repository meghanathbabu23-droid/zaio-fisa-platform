import { useCallback, useEffect, useState } from "react";
import { createExam, createPracticalExam, deleteExam, fetchCohorts, fetchExams, setExamActive } from "../api";
import { ExamFormModal } from "../components/ExamFormModal";
import { GenerateExamModal } from "../components/GenerateExamModal";
import { PracticalExamFormModal } from "../components/PracticalExamFormModal";
import { PracticalTestCasesModal } from "../components/PracticalTestCasesModal";
import { PracticalQuestionsModal } from "../components/PracticalQuestionsModal";
import { PageHeader } from "../components/PageHeader";
import type { Cohort, ExamInput } from "../types";
import { Button } from "../components/ui/Button";
import { StateBanner } from "../components/ui/StateBanner";
import { Badge } from "../components/ui/Badge";

const emptyExam: ExamInput = {
  title: "",
  type: "MCQ",
  durationMinutes: 45,
  instructions: "Answer all questions. The timer starts when you begin the exam.",
  cohortId: null,
  questions: [],
  totalMarks: 100,
};

export function ExamsPage() {
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [exams, setExams] = useState<Awaited<ReturnType<typeof fetchExams>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [practicalOpen, setPracticalOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [testCasesExam, setTestCasesExam] = useState<{ id: string; title: string } | null>(null);
  const [questionsExam, setQuestionsExam] = useState<{ id: string; title: string; totalMarks: number | null } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchExams(), fetchCohorts()])
      .then(([e, c]) => {
        setExams(e);
        setCohorts(c);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Load failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(data: ExamInput) {
    setSaving(true);
    try {
      await createExam(data);
      setModalOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(examId: string, nextActive: boolean) {
    setError(null);
    try {
      await setExamActive(examId, nextActive);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update exam");
    }
  }

  const activeExams = exams.filter((e) => e.isActive);
  const archivedExams = exams.filter((e) => !e.isActive);
  const visibleExams = showArchived ? archivedExams : activeExams;

  return (
    <>
      <PageHeader
        title="Exams"
        description="MCQ (auto-marked) and practical (multi-file editor) exams."
        action={
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setPracticalOpen(true)}>
              New practical
            </Button>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(true)}>
              New MCQ
            </Button>
            <Button type="button" variant="sun" onClick={() => setGenerateOpen(true)}>
              Generate with AI
            </Button>
          </div>
        }
      />
      <div className="flex-1 space-y-4 p-8">
        {error ? <StateBanner tone="error">{error}</StateBanner> : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              !showArchived ? "bg-zaio-blue text-white" : "border border-zaio-cloud text-zaio-ink"
            }`}
          >
            Active ({activeExams.length})
          </button>
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              showArchived ? "bg-zaio-blue text-white" : "border border-zaio-cloud text-zaio-ink"
            }`}
          >
            Archived ({archivedExams.length})
          </button>
        </div>
        <div className="overflow-hidden rounded-2xl border border-zaio-cloud bg-zaio-card shadow-sm">
          {loading ? (
            <p className="px-6 py-10 text-sm text-zaio-ink/50">Loading…</p>
          ) : visibleExams.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zaio-ink/60">
              {showArchived ? "No archived exams." : "No active exams yet."}
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zaio-cloud bg-zaio-paper/80 text-xs font-medium uppercase tracking-wide text-zaio-ink/50">
                <tr>
                  <th className="px-6 py-3">Title</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Duration</th>
                  <th className="px-6 py-3">Tests / Qs</th>
                  <th className="px-6 py-3">Assigned</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zaio-cloud">
                {visibleExams.map((exam) => (
                  <tr key={exam.id} className="hover:bg-zaio-paper/50 transition-colors">
                    <td className="px-6 py-4 font-medium">
                      {exam.title}
                      {!exam.isActive ? (
                        <Badge tone="neutral">
                          <span className="ml-2">Archived</span>
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-6 py-4">{exam.type}</td>
                    <td className="px-6 py-4">{exam.durationMinutes} min</td>
                    <td className="px-6 py-4">
                      {exam.type === "PRACTICAL"
                        ? (exam._count?.practicalTests ?? 0)
                        : (exam._count?.questions ?? "—")}
                    </td>
                    <td className="px-6 py-4">{exam._count?.assignments ?? "—"}</td>
                    <td className="px-6 py-4 text-right">
                      {exam.type === "PRACTICAL" ? (
                        <>
                          <button
                            type="button"
                            className="mr-3 text-zaio-blue"
                            onClick={() => setQuestionsExam({ id: exam.id, title: exam.title, totalMarks: exam.totalMarks })}
                          >
                            Questions
                          </button>
                          <button
                            type="button"
                            className="mr-3 text-zaio-blue"
                            onClick={() => setTestCasesExam({ id: exam.id, title: exam.title })}
                          >
                            Test cases
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className="mr-3 text-zaio-blue"
                        onClick={() => void toggleActive(exam.id, !exam.isActive)}
                      >
                        {exam.isActive ? "Archive" : "Restore"}
                      </button>
                      <button
                        type="button"
                        className="text-red-600"
                        onClick={async () => {
                          if (!confirm(`Delete exam "${exam.title}"?`)) return;
                          await deleteExam(exam.id);
                          load();
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {modalOpen ? (
        <ExamFormModal
          title="New MCQ exam"
          cohorts={cohorts}
          initial={emptyExam}
          saving={saving}
          onClose={() => setModalOpen(false)}
          onSave={handleSave}
        />
      ) : null}
      {practicalOpen ? (
        <PracticalExamFormModal
          cohorts={cohorts}
          saving={saving}
          onClose={() => setPracticalOpen(false)}
          onSave={async (data) => {
            setSaving(true);
            try {
              await createPracticalExam(data);
              setPracticalOpen(false);
              load();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Save failed");
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}
      {testCasesExam ? (
        <PracticalTestCasesModal
          examId={testCasesExam.id}
          examTitle={testCasesExam.title}
          onClose={() => {
            setTestCasesExam(null);
            load();
          }}
        />
      ) : null}
      {questionsExam ? (
        <PracticalQuestionsModal
          examId={questionsExam.id}
          examTitle={questionsExam.title}
          totalMarks={questionsExam.totalMarks}
          onClose={() => {
            setQuestionsExam(null);
            load();
          }}
        />
      ) : null}
      {generateOpen ? (
        <GenerateExamModal cohorts={cohorts} onClose={() => setGenerateOpen(false)} onGenerated={load} />
      ) : null}
    </>
  );
}
