import { clearStudentToken, getStudentToken } from "./student/session";
import { getCsrfToken, notifyAdminUnauthorized } from "./admin/session";
import type {
  AdminIdentity,
  AdminUserInput,
  AdminUserRow,
  Cohort,
  CohortInput,
  Exam,
  ExamAssignment,
  ExamInput,
  McqExamView,
  OtpChannel,
  OtpRequestResponse,
  AssessorAssignmentDetail,
  AssessorPracticalRow,
  ModerationDetail,
  ModerationListItem,
  ModerationStatus,
  EvidenceDetail,
  EvidenceListRow,
  ProctoringMonitorSession,
  ResultsRow,
  ResultsSummary,
  PracticalSubmissionRecord,
  PracticalTestCase,
  PracticalTestReport,
  PracticalWorkspace,
  Student,
  StudentAuthStudent,
  StudentInput,
} from "./types";
import { downloadResultsXlsx } from "./lib/exportResults";
import type { WorkspaceFile } from "./lib/preview";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

function jsonHeaders(extra?: HeadersInit): HeadersInit {
  return { "Content-Type": "application/json", ...extra };
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Sends the httpOnly admin session cookie automatically (credentials:
 * include) and, for mutating requests, echoes the readable CSRF cookie back
 * as a header (the double-submit pattern requireAdminAuth checks). On a
 * 401, notifies AdminRoute to fall back to the login screen — the admin
 * never has to manually "log out" after an expired or revoked session, the
 * next API call surfaces it. */
async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const csrf = getCsrfToken();
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...jsonHeaders(init?.headers),
      ...(MUTATING_METHODS.has(method) && csrf ? { "X-CSRF-Token": csrf } : {}),
    },
  });
  if (res.status === 401) {
    notifyAdminUnauthorized();
  }
  return res;
}

// ——— Admin auth (individual accounts, not a shared key) ———

export async function loginAdmin(email: string, password: string): Promise<AdminIdentity> {
  const res = await fetch("/api/admin/login", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password }),
  });
  return handleResponse<AdminIdentity>(res);
}

export async function logoutAdmin(): Promise<void> {
  await handleResponse<void>(await adminFetch("/api/admin/logout", { method: "POST" }));
}

/** Throws (401) when there's no valid session — used by AdminAuthContext to
 * probe for an existing session on load/refresh, not just after login. */
export async function fetchAdminMe(): Promise<AdminIdentity> {
  return handleResponse<AdminIdentity>(await adminFetch("/api/admin/me"));
}

export async function changeAdminPassword(currentPassword: string, newPassword: string): Promise<void> {
  await handleResponse<{ ok: boolean }>(
    await adminFetch("/api/admin/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    })
  );
}

export async function requestAdminPasswordReset(email: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/api/admin/password-reset/request", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}

export async function confirmAdminPasswordReset(token: string, newPassword: string): Promise<void> {
  const res = await fetch("/api/admin/password-reset/confirm", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ token, newPassword }),
  });
  await handleResponse<{ ok: boolean }>(res);
}

// ——— Admin accounts (SUPER_ADMIN only) ———

export async function fetchAdminUsers(): Promise<AdminUserRow[]> {
  return handleResponse(await adminFetch("/api/admin/users"));
}

export async function createAdminUser(data: AdminUserInput): Promise<AdminUserRow> {
  return handleResponse(await adminFetch("/api/admin/users", { method: "POST", body: JSON.stringify(data) }));
}

export async function updateAdminUser(
  id: string,
  data: Partial<Pick<AdminUserInput, "fullName" | "role"> & { active: boolean }>
): Promise<AdminUserRow> {
  return handleResponse(await adminFetch(`/api/admin/users/${id}`, { method: "PUT", body: JSON.stringify(data) }));
}

export async function deleteAdminUser(id: string): Promise<void> {
  await handleResponse(await adminFetch(`/api/admin/users/${id}`, { method: "DELETE" }));
}

export async function revokeAdminUserSessions(id: string): Promise<{ ok: boolean; revoked: number }> {
  return handleResponse(await adminFetch(`/api/admin/users/${id}/revoke-sessions`, { method: "POST" }));
}

function filenameFromContentDisposition(res: Response, fallback: string): string {
  const header = res.headers.get("content-disposition") ?? "";
  const match = header.match(/filename="([^"]+)"/);
  return match ? match[1] : fallback;
}

/** Downloads a file from an admin-protected endpoint via fetch+blob, since a
 * plain <a href> can't send credentials: "include" or a CSRF header. */
async function downloadViaAdminFetch(path: string, fallbackFilename: string): Promise<void> {
  const res = await adminFetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  const filename = filenameFromContentDisposition(res, fallbackFilename);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ——— Cohorts ———

export async function fetchCohorts(): Promise<Cohort[]> {
  return handleResponse(await adminFetch("/api/cohorts"));
}

export async function createCohort(data: CohortInput): Promise<Cohort> {
  return handleResponse(
    await adminFetch("/api/cohorts", { method: "POST", body: JSON.stringify(data) })
  );
}

export async function updateCohort(id: string, data: CohortInput): Promise<Cohort> {
  return handleResponse(
    await adminFetch(`/api/cohorts/${id}`, { method: "PUT", body: JSON.stringify(data) })
  );
}

export async function setCohortOtpEligibility(id: string, eligible: boolean): Promise<{ id: string; realOtpEligible: boolean }> {
  return handleResponse(
    await adminFetch(`/api/cohorts/${id}/otp-eligibility`, {
      method: "PUT",
      body: JSON.stringify({ eligible }),
    })
  );
}

export async function deleteCohort(id: string): Promise<void> {
  await handleResponse(await adminFetch(`/api/cohorts/${id}`, { method: "DELETE" }));
}

// ——— Students ———

export async function fetchStudents(): Promise<Student[]> {
  return handleResponse(await adminFetch("/api/students"));
}

export async function createStudent(data: StudentInput): Promise<Student> {
  return handleResponse(
    await adminFetch("/api/students", { method: "POST", body: JSON.stringify(data) })
  );
}

export async function updateStudent(id: string, data: StudentInput): Promise<Student> {
  return handleResponse(
    await adminFetch(`/api/students/${id}`, { method: "PUT", body: JSON.stringify(data) })
  );
}

export async function deleteStudent(id: string): Promise<void> {
  await handleResponse(await adminFetch(`/api/students/${id}`, { method: "DELETE" }));
}

export async function revokeStudentSessions(id: string): Promise<{ ok: boolean; revoked: number }> {
  return handleResponse(await adminFetch(`/api/students/${id}/revoke-sessions`, { method: "POST" }));
}

// ——— Exams ———

export async function fetchExams(activeOnly?: boolean): Promise<Exam[]> {
  const q = activeOnly === undefined ? "" : `?active=${activeOnly}`;
  return handleResponse(await adminFetch(`/api/exams${q}`));
}

export async function setExamActive(id: string, isActive: boolean): Promise<{ id: string; isActive: boolean }> {
  return handleResponse(
    await adminFetch(`/api/exams/${id}/active`, { method: "PUT", body: JSON.stringify({ isActive }) })
  );
}

export async function fetchExam(id: string): Promise<Exam> {
  return handleResponse(await adminFetch(`/api/exams/${id}`));
}

export async function createExam(data: ExamInput): Promise<Exam> {
  return handleResponse(
    await adminFetch("/api/exams", { method: "POST", body: JSON.stringify(data) })
  );
}

export async function createPracticalExam(data: {
  title: string;
  durationMinutes: number;
  instructions: string;
  cohortId: string | null;
}): Promise<Exam> {
  return handleResponse(
    await adminFetch("/api/exams", {
      method: "POST",
      body: JSON.stringify({ ...data, type: "PRACTICAL" }),
    })
  );
}

export async function updateExam(id: string, data: Omit<ExamInput, "questions"> & { questions?: ExamInput["questions"] }): Promise<Exam> {
  return handleResponse(
    await adminFetch(`/api/exams/${id}`, { method: "PUT", body: JSON.stringify(data) })
  );
}

export async function deleteExam(id: string): Promise<void> {
  await handleResponse(await adminFetch(`/api/exams/${id}`, { method: "DELETE" }));
}

// ——— Assignments ———

export async function fetchAssignments(): Promise<ExamAssignment[]> {
  return handleResponse(await adminFetch("/api/assignments"));
}

export async function createAssignment(examId: string, studentId: string): Promise<ExamAssignment> {
  return handleResponse(
    await adminFetch("/api/assignments", {
      method: "POST",
      body: JSON.stringify({ examId, studentId }),
    })
  );
}

export async function assignExamToCohort(examId: string, cohortId: string): Promise<{ count: number }> {
  return handleResponse(
    await adminFetch("/api/assignments/bulk-cohort", {
      method: "POST",
      body: JSON.stringify({ examId, cohortId }),
    })
  );
}

export async function deleteAssignment(id: string): Promise<void> {
  await handleResponse(await adminFetch(`/api/assignments/${id}`, { method: "DELETE" }));
}

// ——— Student auth & portal (public / student-authenticated — never adminFetch) ———

export async function requestOtp(channel: OtpChannel, value: string): Promise<OtpRequestResponse> {
  return handleResponse(
    await fetch("/api/auth/otp/request", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(channel === "email" ? { email: value } : { phone: value }),
    })
  );
}

export async function verifyOtp(
  channel: OtpChannel,
  value: string,
  code: string
): Promise<{ token: string; student: StudentAuthStudent }> {
  return handleResponse(
    await fetch("/api/auth/otp/verify", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(channel === "email" ? { email: value, code } : { phone: value, code }),
    })
  );
}

/**
 * Temporary internal-tester self-registration — only reachable when the
 * server has this explicitly enabled (NODE_ENV!=="production" AND
 * OTP_DELIVERY_MODE=mock AND ENABLE_OPEN_TEST_REGISTRATION=true). The
 * server 404s this route entirely when disabled, which this surfaces as a
 * normal thrown error via handleResponse — callers should show that error
 * text rather than assume the feature is always available.
 */
export async function registerTester(
  fullName: string,
  email: string,
  phone: string
): Promise<{ ok: true; reused: boolean; student: { id: string; firstName: string; lastName: string; email: string; phone: string | null } }> {
  return handleResponse(
    await fetch("/api/auth/register-tester", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ fullName, email, phone }),
    })
  );
}

function authedStudentFetch(path: string, init?: RequestInit) {
  const token = getStudentToken();
  return fetch(path, {
    ...init,
    headers: {
      ...jsonHeaders(init?.headers),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export async function fetchStudentAssignments(): Promise<ExamAssignment[]> {
  return handleResponse(await authedStudentFetch("/api/student/assignments"));
}

export async function startMcqExam(assignmentId: string) {
  return handleResponse<{
    remainingSeconds: number;
    durationMinutes: number;
    startedAt: string;
  }>(await authedStudentFetch(`/api/student/assignments/${assignmentId}/start`, { method: "POST" }));
}

export async function loadMcqExam(assignmentId: string): Promise<McqExamView> {
  return handleResponse(await authedStudentFetch(`/api/student/assignments/${assignmentId}/exam`));
}

export async function submitMcqExam(assignmentId: string, answers: number[]) {
  return handleResponse<{
    scorePercent: number;
    correct: number;
    total: number;
    autoMarked: boolean;
  }>(
    await authedStudentFetch(`/api/student/assignments/${assignmentId}/submit`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    })
  );
}

export async function logoutStudent(): Promise<void> {
  await authedStudentFetch("/api/auth/logout", { method: "POST" });
  clearStudentToken();
}

export async function fetchPracticalWorkspace(assignmentId: string): Promise<{
  exam: { title: string; instructions: string; durationMinutes: number };
  workspace: PracticalWorkspace;
}> {
  return handleResponse(await authedStudentFetch(`/api/student/assignments/${assignmentId}/practical`));
}

export async function autosavePractical(
  assignmentId: string,
  files: WorkspaceFile[],
  activeFile: string
): Promise<{ savedAt: string; workspace: PracticalWorkspace }> {
  return handleResponse(
    await authedStudentFetch(`/api/student/assignments/${assignmentId}/practical/autosave`, {
      method: "PUT",
      body: JSON.stringify({ files, activeFile }),
    })
  );
}

export async function createPracticalFile(assignmentId: string, filename: string) {
  return handleResponse(
    await authedStudentFetch(`/api/student/assignments/${assignmentId}/practical/files`, {
      method: "POST",
      body: JSON.stringify({ filename }),
    })
  );
}

export async function renamePracticalFile(assignmentId: string, oldName: string, newName: string) {
  return handleResponse(
    await authedStudentFetch(
      `/api/student/assignments/${assignmentId}/practical/files/${encodeURIComponent(oldName)}`,
      { method: "PATCH", body: JSON.stringify({ newName }) }
    )
  );
}

export async function deletePracticalFile(assignmentId: string, filename: string): Promise<void> {
  await handleResponse(
    await authedStudentFetch(
      `/api/student/assignments/${assignmentId}/practical/files/${encodeURIComponent(filename)}`,
      { method: "DELETE" }
    )
  );
}

export async function submitPracticalExam(assignmentId: string) {
  return handleResponse(
    await authedStudentFetch(`/api/student/assignments/${assignmentId}/practical/submit`, {
      method: "POST",
    })
  );
}

/** Ephemeral "practice run" of the exam's test cases against the student's
 * current workspace — never persists a submission or affects the final
 * score. Can be called as often as the student likes. */
export async function runPracticalTests(assignmentId: string): Promise<PracticalTestReport> {
  return handleResponse(
    await authedStudentFetch(`/api/student/assignments/${assignmentId}/practical/run-tests`, {
      method: "POST",
    })
  );
}

export async function fetchPracticalTestCases(examId: string): Promise<PracticalTestCase[]> {
  return handleResponse(await adminFetch(`/api/exams/${examId}/practical-tests`));
}

export async function createPracticalTestCase(
  examId: string,
  data: Omit<PracticalTestCase, "id" | "examId" | "sortOrder">
): Promise<PracticalTestCase> {
  return handleResponse(
    await adminFetch(`/api/exams/${examId}/practical-tests`, {
      method: "POST",
      body: JSON.stringify(data),
    })
  );
}

export async function deletePracticalTestCase(examId: string, testId: string): Promise<void> {
  await handleResponse(
    await adminFetch(`/api/exams/${examId}/practical-tests/${testId}`, { method: "DELETE" })
  );
}

export async function createProctoringSession(assignmentId: string) {
  return handleResponse<{
    sessionId: string;
    simulatedDemo: boolean;
    sebNote: string;
    zoomSecondCamera: string;
  }>(
    await authedStudentFetch("/api/student/proctoring/sessions", {
      method: "POST",
      body: JSON.stringify({ assignmentId }),
    })
  );
}

export async function activateProctoringSession(
  sessionId: string,
  flags?: { webcamRecording?: boolean; screenRecording?: boolean }
) {
  return handleResponse(
    await authedStudentFetch(`/api/student/proctoring/sessions/${sessionId}/activate`, {
      method: "POST",
      body: JSON.stringify({
        webcamRecording: flags?.webcamRecording === true,
        screenRecording: flags?.screenRecording === true,
      }),
    })
  );
}

export async function postProctoringEvent(
  sessionId: string,
  type: string,
  message: string,
  opts?: { keepalive?: boolean }
) {
  return handleResponse(
    await authedStudentFetch(`/api/student/proctoring/sessions/${sessionId}/events`, {
      method: "POST",
      body: JSON.stringify({ type, message }),
      keepalive: opts?.keepalive,
    })
  );
}

export async function endProctoringSession(sessionId: string) {
  return handleResponse(
    await authedStudentFetch(`/api/student/proctoring/sessions/${sessionId}/end`, {
      method: "POST",
    })
  );
}

export async function uploadProctoringRecording(
  sessionId: string,
  kind: "WEBCAM_MIC" | "SCREEN",
  mimeType: string,
  dataBase64: string
) {
  return handleResponse(
    await authedStudentFetch(`/api/student/proctoring/sessions/${sessionId}/recordings`, {
      method: "POST",
      body: JSON.stringify({ kind, mimeType, dataBase64 }),
    })
  );
}

export async function fetchProctoringMonitor(activeOnly: boolean): Promise<{
  simulatedDemo: boolean;
  sessions: ProctoringMonitorSession[];
}> {
  return handleResponse(await adminFetch(`/api/proctoring/sessions?active=${activeOnly}`));
}

export async function fetchModerationQueue(status?: ModerationStatus): Promise<{
  counts: { pending: number; reviewed: number; completed: number };
  items: ModerationListItem[];
}> {
  const q = status ? `?status=${status}` : "";
  return handleResponse(await adminFetch(`/api/moderation${q}`));
}

export async function fetchModerationDetail(assignmentId: string): Promise<ModerationDetail> {
  return handleResponse(await adminFetch(`/api/moderation/${assignmentId}`));
}

export async function saveModerationDecision(
  assignmentId: string,
  body: {
    moderatorName: string;
    decision: string;
    comments: string;
    status: ModerationStatus;
  }
) {
  return handleResponse(
    await adminFetch(`/api/moderation/${assignmentId}/decide`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

export async function fetchResults(filters?: {
  cohortId?: string;
  examId?: string;
  studentId?: string;
}): Promise<{ summary: ResultsSummary; rows: ResultsRow[] }> {
  const params = new URLSearchParams();
  if (filters?.cohortId) params.set("cohortId", filters.cohortId);
  if (filters?.examId) params.set("examId", filters.examId);
  if (filters?.studentId) params.set("studentId", filters.studentId);
  const q = params.toString();
  return handleResponse(await adminFetch(`/api/results${q ? `?${q}` : ""}`));
}

export function exportResultsXlsx(rows: ResultsRow[]) {
  downloadResultsXlsx(rows);
}

export async function fetchAssessorPracticalList(): Promise<AssessorPracticalRow[]> {
  return handleResponse(await adminFetch("/api/assessor/practical-submissions"));
}

export async function fetchAssessorAssignmentDetail(
  assignmentId: string
): Promise<AssessorAssignmentDetail> {
  return handleResponse(await adminFetch(`/api/assessor/assignments/${assignmentId}`));
}

export async function rerunPracticalTests(assignmentId: string) {
  return handleResponse(
    await adminFetch(`/api/assessor/assignments/${assignmentId}/rerun-tests`, { method: "POST" })
  );
}

export async function saveAssessorReview(
  assignmentId: string,
  finalScorePercent: number,
  feedback: string
) {
  return handleResponse(
    await adminFetch(`/api/assessor/assignments/${assignmentId}/review`, {
      method: "POST",
      body: JSON.stringify({ finalScorePercent, feedback }),
    })
  );
}

// ——— Evidence ———

export async function fetchEvidenceList(filters?: {
  cohortId?: string;
  examId?: string;
  studentId?: string;
  artifactStatus?: EvidenceListRow["artifacts"][0]["status"];
}): Promise<{ rows: EvidenceListRow[]; demoNote: string }> {
  const params = new URLSearchParams();
  if (filters?.cohortId) params.set("cohortId", filters.cohortId);
  if (filters?.examId) params.set("examId", filters.examId);
  if (filters?.studentId) params.set("studentId", filters.studentId);
  if (filters?.artifactStatus) params.set("artifactStatus", filters.artifactStatus);
  const q = params.toString();
  return handleResponse(await adminFetch(`/api/evidence${q ? `?${q}` : ""}`));
}

export async function fetchEvidenceDetail(assignmentId: string): Promise<EvidenceDetail> {
  return handleResponse(await adminFetch(`/api/evidence/${assignmentId}`));
}

export async function syncAllEvidence(): Promise<{ assignmentsSynced: number }> {
  return handleResponse(await adminFetch("/api/evidence/sync", { method: "POST" }));
}

/** Downloads an evidence artifact (including proctoring recordings) via an
 * authenticated fetch+blob — a plain <a href> can't carry the admin session
 * cookie's CSRF pairing, and leaving this route reachable without it would
 * be exactly the "alternate download endpoint" bypass the audit warned
 * about. */
export async function downloadEvidenceArtifact(assignmentId: string, artifactId: string): Promise<void> {
  return downloadViaAdminFetch(
    `/api/evidence/${assignmentId}/artifacts/${artifactId}/download`,
    "evidence-artifact"
  );
}

export async function downloadEvidenceSummaryReport(assignmentId: string): Promise<void> {
  return downloadViaAdminFetch(
    `/api/evidence/${assignmentId}/summary-report?format=json`,
    "evidence-summary-report.json"
  );
}

export async function fetchPracticalSubmissionHistory(assignmentId: string): Promise<{
  assignment: {
    id: string;
    status: string;
    student?: Student;
    exam?: Exam;
  };
  submissions: PracticalSubmissionRecord[];
}> {
  return handleResponse(await adminFetch(`/api/assignments/${assignmentId}/practical/history`));
}
