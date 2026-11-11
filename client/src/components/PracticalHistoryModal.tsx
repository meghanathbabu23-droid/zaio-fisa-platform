import { useEffect, useState } from "react";
import { fetchPracticalSubmissionHistory } from "../api";
import type { PracticalSubmissionRecord } from "../types";
import { StateBanner } from "./ui/StateBanner";

export function PracticalHistoryModal({
  assignmentId,
  onClose,
}: {
  assignmentId: string;
  onClose: () => void;
}) {
  const [submissions, setSubmissions] = useState<PracticalSubmissionRecord[]>([]);
  const [studentName, setStudentName] = useState("");
  const [examTitle, setExamTitle] = useState("");
  const [selected, setSelected] = useState(0);
  const [activeFile, setActiveFile] = useState("index.html");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPracticalSubmissionHistory(assignmentId)
      .then((data) => {
        setSubmissions(data.submissions);
        setStudentName(
          data.assignment.student
            ? `${data.assignment.student.firstName} ${data.assignment.student.lastName}`
            : ""
        );
        setExamTitle(data.assignment.exam?.title ?? "");
        if (data.submissions[0]?.files[0]) setActiveFile(data.submissions[0].files[0].filename);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [assignmentId]);

  const snap = submissions[selected];
  const fileContent = snap?.files.find((f) => f.filename === activeFile)?.content ?? "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zaio-ink/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-zaio-cloud bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zaio-cloud px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-zaio-ink">Submission history</h2>
            <p className="text-xs text-zaio-ink/50">
              {examTitle} · {studentName}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-zaio-ink/60 hover:text-zaio-ink">
            Close
          </button>
        </div>
        {error ? (
          <div className="px-6 py-2">
            <StateBanner tone="error" bleed>
              {error}
            </StateBanner>
          </div>
        ) : null}
        {!submissions.length ? (
          <p className="px-6 py-12 text-center text-sm text-zaio-ink/50">No submissions yet.</p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] gap-0 lg:grid-cols-[220px_1fr] lg:grid-rows-1">
            <ul className="border-b border-zaio-cloud p-3 text-sm lg:border-b-0 lg:border-r">
              {submissions.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg px-2 py-2 text-left ${
                      selected === i ? "bg-zaio-blue text-white" : "hover:bg-zaio-paper"
                    }`}
                    onClick={() => {
                      setSelected(i);
                      if (s.files[0]) setActiveFile(s.files[0].filename);
                    }}
                  >
                    {new Date(s.submittedAt).toLocaleString()}
                    {s.isFinal ? " · Final" : ""}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex min-h-0 flex-col">
              <div className="flex gap-2 border-b p-2 text-xs">
                {snap?.files.map((f) => (
                  <button
                    key={f.filename}
                    type="button"
                    className={`rounded px-2 py-1 ${activeFile === f.filename ? "bg-zaio-paper" : ""}`}
                    onClick={() => setActiveFile(f.filename)}
                  >
                    {f.filename}
                  </button>
                ))}
              </div>
              <pre className="min-h-0 flex-1 overflow-auto bg-zaio-ink p-4 text-xs text-zaio-paper">
                {fileContent}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
