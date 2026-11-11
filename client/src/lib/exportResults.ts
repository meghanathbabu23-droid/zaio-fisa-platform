import * as XLSX from "xlsx";
import type { ResultsRow } from "../types";

export function downloadResultsXlsx(rows: ResultsRow[], filename = "zaio-fisa-results.xlsx") {
  const data = rows.map((r) => ({
    Student: `${r.student.firstName} ${r.student.lastName}`,
    Email: r.student.email,
    Cohort: r.cohort.name,
    Exam: r.exam.title,
    "Exam type": r.exam.type,
    "Assignment status": r.status,
    "Review state": r.reviewState,
    "MCQ score %": r.mcqScorePercent ?? "",
    "Practical automated %": r.practicalAutomatedPercent ?? "",
    "Assessor-approved %": r.assessorApprovedPercent ?? "",
    "Assessor feedback": r.assessorFeedback ?? "",
    Assigned: r.assignedAt ? new Date(r.assignedAt).toISOString() : "",
    Submitted: r.submittedAt ? new Date(r.submittedAt).toISOString() : "",
  }));

  const sheet = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Results");
  XLSX.writeFile(wb, filename);
}
