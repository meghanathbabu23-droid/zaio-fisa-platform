import * as XLSX from "xlsx";
import type { EvidenceListRow } from "../types";

export function downloadEvidenceSummaryXlsx(
  rows: EvidenceListRow[],
  filename = "zaio-fisa-evidence-summary.xlsx"
) {
  const data = rows.map((r) => ({
    Cohort: r.cohort.name,
    Student: `${r.student.firstName} ${r.student.lastName}`,
    Email: r.student.email,
    Exam: r.exam.title,
    "Exam type": r.exam.type,
    "Submission status": r.submissionStatus,
    "Recording status": r.recordingStatus,
    "Artifact count": r.artifactCount,
    Missing: r.missingCount,
    Simulated: r.simulatedCount,
    Assigned: new Date(r.assignedAt).toISOString(),
    "Last synced": new Date(r.lastSyncedAt).toISOString(),
    "Assignment ID": r.assignmentId,
  }));

  const sheet = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Evidence");
  XLSX.writeFile(wb, filename);
}
