export interface Cohort {
  id: string;
  name: string;
  programme: string;
  startDate: string;
  examDate: string;
  zoomLink: string;
  /** Real email/SMS OTP delivery is only attempted for this cohort's
   * students when this is true AND the server is globally in live mode. */
  realOtpEligible: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CohortInput = Omit<Cohort, "id" | "createdAt" | "updatedAt" | "realOtpEligible">;

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  cohortId: string;
  cohort?: Cohort;
  /** True only for records created by the temporary open tester
   * self-registration flow — never set for a real/admin-created student. */
  isTestRegistration: boolean;
  createdAt: string;
  updatedAt: string;
}

export type StudentInput = Pick<Student, "firstName" | "lastName" | "email" | "phone" | "cohortId">;

export type ExamType = "MCQ" | "PRACTICAL";

export interface McqQuestionInput {
  prompt: string;
  options: string[];
  correctIndex: number;
  marks: number;
}

export interface McqQuestion extends McqQuestionInput {
  id: string;
  examId: string;
  sortOrder: number;
}

export interface Exam {
  id: string;
  title: string;
  type: ExamType;
  durationMinutes: number;
  instructions: string;
  /** False for an obsolete/duplicate/QA-audit exam hidden from the active
   * exam-assignment picker — never deleted, existing assignments unaffected. */
  isActive: boolean;
  totalMarks: number | null;
  cohortId: string | null;
  cohort?: Cohort | null;
  createdAt: string;
  updatedAt: string;
  questions?: McqQuestion[];
  practicalTests?: PracticalTestCase[];
  _count?: { questions: number; assignments: number; practicalTests?: number };
}

export type PracticalTestKind =
  | "HTML_CONTAINS"
  | "CSS_CONTAINS"
  | "JS_CONTAINS"
  | "HTML_SELECTOR"
  | "FILE_REGEX"
  | "DOM_BEHAVIOR";

export type DomBehaviorAction = "fill" | "click" | "select" | "check" | "wait";
export type DomBehaviorCondition =
  | "exists"
  | "notExists"
  | "textContains"
  | "hasClass"
  | "attributeEquals"
  | "countEquals";

export interface DomBehaviorStep {
  action: DomBehaviorAction;
  selector?: string;
  value?: string;
  ms?: number;
}

export interface DomBehaviorSpec {
  steps: DomBehaviorStep[];
  assert: { selector: string; condition: DomBehaviorCondition; value?: string };
}

export interface PracticalTestCase {
  id: string;
  examId: string;
  label: string;
  kind: PracticalTestKind;
  targetFile: string | null;
  expression: string;
  points: number;
  sortOrder: number;
  /** True (default) = private/hidden evaluation case, never shown to or
   * run for a student's practice run. False = a public sample test case. */
  isHidden: boolean;
}

export type TestCaseResult = {
  testCaseId: string;
  label: string;
  kind: PracticalTestKind;
  points: number;
  earned: number;
  passed: boolean;
  detail: string;
};

/** Returned by both the student-facing "Run Tests" practice endpoint and
 * the assessor automated-assessment report — same shape either way. */
export type PracticalTestReport = {
  results: TestCaseResult[];
  earnedPoints: number;
  maxPoints: number;
  scorePercent: number;
  note?: string;
};

export type ResultsReviewState = "not_started" | "in_progress" | "pending_review" | "finalised";

export interface ResultsRow {
  assignmentId: string;
  status: string;
  assignedAt: string;
  submittedAt: string | null;
  student: { id: string; firstName: string; lastName: string; email: string };
  cohort: { id: string; name: string };
  exam: { id: string; title: string; type: string };
  mcqScorePercent: number | null;
  practicalAutomatedPercent: number | null;
  assessorApprovedPercent: number | null;
  assessorFeedback: string | null;
  reviewState: ResultsReviewState;
}

export type ModerationStatus = "PENDING" | "REVIEWED" | "COMPLETED";

export type AdvisoryFlag = {
  code: string;
  message: string;
  advisory: true;
};

export interface ProctoringMonitorSession {
  id: string;
  assignmentId: string;
  studentName: string;
  examTitle: string;
  status: string;
  webcamStatus: string;
  screenStatus: string;
  startedAt: string;
  endedAt: string | null;
  eventCount: number;
  recentEvents: {
    type: string;
    message: string;
    createdAt: string;
    advisory: boolean;
  }[];
  recordings: {
    kind: string;
    filename: string;
    sizeBytes: number;
    captureTier?: string;
    verifiedReal?: boolean;
    storedAt?: string;
  }[];
}

export type EvidenceArtifactStatus = "PRESENT" | "MISSING" | "SIMULATED";

export type EvidenceArtifactKind =
  | "MCQ_ATTEMPT"
  | "PRACTICAL_SUBMISSION"
  | "CODE_HISTORY"
  | "PROCTORING_RECORDING"
  | "PROCTORING_EVENTS"
  | "ASSESSOR_REVIEW"
  | "MODERATION";

export interface EvidenceListRow {
  assignmentId: string;
  evidenceId: string;
  cohort: { id: string; name: string };
  student: { id: string; firstName: string; lastName: string; email: string };
  exam: { id: string; title: string; type: ExamType };
  submissionStatus: AssignmentStatus;
  recordingStatus: string;
  assignedAt: string;
  lastSyncedAt: string;
  artifactCount: number;
  missingCount: number;
  simulatedCount: number;
  artifacts: {
    id: string;
    kind: EvidenceArtifactKind;
    status: EvidenceArtifactStatus;
    label: string;
    capturedAt: string | null;
    downloadable: boolean;
  }[];
}

export interface EvidenceDetail {
  assignment: { id: string; status: AssignmentStatus; assignedAt: string };
  cohort: Cohort;
  student: { id: string; firstName: string; lastName: string; email: string };
  exam: Exam;
  evidence: {
    id: string;
    submissionStatus: AssignmentStatus;
    recordingStatus: string;
    lastSyncedAt: string;
    artifacts: {
      id: string;
      kind: EvidenceArtifactKind;
      status: EvidenceArtifactStatus;
      label: string;
      sourceRecordId: string;
      filePath: string | null;
      mimeType: string | null;
      sizeBytes: number | null;
      capturedAt: string | null;
      meta: Record<string, unknown>;
    }[];
  };
  auditTrail: {
    id: string;
    action: string;
    actorLabel: string;
    detail: string;
    createdAt: string;
  }[];
}

export interface ModerationListItem {
  assignmentId: string;
  studentName: string;
  cohortName: string;
  examTitle: string;
  submittedAt: string | null;
  automatedScorePercent: number | null;
  assessorApprovedPercent: number | null;
  moderationStatus: ModerationStatus;
  advisoryFlags: AdvisoryFlag[];
  flagCount: number;
}

export interface ModerationDetail {
  assignment: {
    id: string;
    status: string;
    student?: Student;
    exam?: Exam;
  };
  submission: {
    id: string;
    submittedAt: string;
    files: { filename: string; content: string }[];
  } | null;
  automated: {
    scorePercent: number;
    earnedPoints: number;
    maxPoints: number;
    ranAt: string;
    report: { results: TestCaseResult[] };
  } | null;
  assessorReview: {
    automatedScorePercent: number;
    finalScorePercent: number | null;
    feedback: string;
    updatedAt: string;
  } | null;
  moderation: {
    status: ModerationStatus;
    advisoryFlags: AdvisoryFlag[];
    history: {
      id: string;
      moderatorName: string;
      decision: string;
      comments: string;
      statusAfter: ModerationStatus;
      createdAt: string;
    }[];
  };
}

export interface ResultsSummary {
  total: number;
  submitted: number;
  inProgress: number;
  notStarted: number;
  pendingReview: number;
  finalised: number;
}

export interface AssessorPracticalRow {
  assignmentId: string;
  studentName: string;
  examTitle: string;
  submittedAt: string | null;
  submissionId: string | null;
  automatedScorePercent: number | null;
  finalScorePercent: number | null;
  hasFeedback: boolean;
}

export interface AssessorAssignmentDetail {
  assignment: {
    id: string;
    status: string;
    student?: Student;
    exam?: Exam;
  };
  submission: {
    id: string;
    submittedAt: string;
    files: { filename: string; content: string }[];
  } | null;
  automated: {
    scorePercent: number;
    earnedPoints: number;
    maxPoints: number;
    ranAt: string;
    report: { results: TestCaseResult[] };
  } | null;
  review: {
    automatedScorePercent: number;
    finalScorePercent: number | null;
    feedback: string;
    updatedAt: string;
  } | null;
  reviewLog: {
    id: string;
    automatedScorePercent: number;
    finalScorePercent: number | null;
    feedback: string;
    createdAt: string;
  }[];
}

export interface ExamInput {
  title: string;
  type: ExamType;
  durationMinutes: number;
  instructions: string;
  cohortId: string | null;
  questions: McqQuestionInput[];
  totalMarks: number;
}

export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type DifficultySplit = { EASY: number; MEDIUM: number; HARD: number };

/** Sent to POST /api/exams/generate — mirrors the server's GenerationConfig
 * exactly (server/src/lib/questionGenerator.ts). */
export interface GenerationRequest {
  type: ExamType;
  title: string;
  topics: string[];
  count: number;
  difficulty: DifficultySplit;
  totalMarks: number;
  durationMinutes: number;
  cohortId: string | null;
  publicWeightPct?: number;
}

export interface GenerationUnresolvedSlot {
  topic: string;
  difficulty: Difficulty;
}

/** Discriminated result from generateExamQuestions() — never thrown, so the
 * UI can branch on each distinct outcome (success, validation error, AI not
 * configured, already running, insufficient uniqueness, other failure). */
export type GenerationOutcome =
  | {
      kind: "success";
      jobId: string;
      exam: Exam;
      topicCoverage: Record<string, number>;
      difficultyDistribution: Record<string, number>;
    }
  | { kind: "invalid"; error: string }
  | { kind: "not_configured"; error: string }
  | { kind: "locked"; error: string }
  | { kind: "insufficient_uniqueness"; error: string; unresolvedSlots: GenerationUnresolvedSlot[] }
  | { kind: "server_error"; error: string };

export type AssignmentStatus = "ASSIGNED" | "IN_PROGRESS" | "SUBMITTED";

export interface PracticalWorkspaceMeta {
  lockedAt: string | null;
  lastSavedAt: string;
  activeFile?: string;
}

export interface PracticalWorkspace {
  id: string;
  assignmentId: string;
  studentId: string;
  activeFile: string;
  startedAt: string;
  lockedAt: string | null;
  lastSavedAt: string;
  locked: boolean;
  files: { id: string; filename: string; content: string; updatedAt: string }[];
}

export interface PracticalSubmissionRecord {
  id: string;
  submittedAt: string;
  isFinal: boolean;
  files: { filename: string; content: string }[];
}

export interface ExamAssignment {
  id: string;
  examId: string;
  studentId: string;
  status: AssignmentStatus;
  assignedAt: string;
  exam?: Exam;
  student?: Student;
  attempt?: McqAttempt | null;
  workspace?: PracticalWorkspaceMeta | null;
}

export interface McqAttempt {
  id: string;
  assignmentId: string;
  answers: string | null;
  scorePercent: number | null;
  startedAt: string;
  submittedAt: string | null;
}

export interface StudentAuthStudent {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface OtpRequestResponse {
  ok: boolean;
  expiresAt: string;
  message: string;
  cooldownSeconds: number;
}

/** Student OTP sign-in is email-only; "email" is the only value any caller
 * constructs today. Kept as its own type (rather than inlining `"email"`
 * at the two call sites) since it mirrors the server's OtpChannel enum. */
export type OtpChannel = "email";

export interface McqExamView {
  title: string;
  instructions: string;
  durationMinutes: number;
  remainingSeconds: number;
  questions: { id: string; prompt: string; options: string[] }[];
}

// ——— Administrator accounts / RBAC ———

export type AdminRole = "SUPER_ADMIN" | "ADMIN" | "ASSESSOR" | "MODERATOR";

export interface AdminIdentity {
  id: string;
  email: string;
  fullName: string;
  role: AdminRole;
}

export interface AdminUserRow {
  id: string;
  fullName: string;
  email: string;
  role: AdminRole;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lockedUntil: string | null;
}

export interface AdminUserInput {
  fullName: string;
  email: string;
  password: string;
  role: AdminRole;
}
