import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./components/AdminLayout";
import { AdminRoute } from "./components/AdminRoute";
import { RequireRole } from "./components/RequireRole";
import { RoleHome } from "./components/RoleHome";
import { Unauthorized } from "./components/Unauthorized";
import { StudentRoute } from "./components/StudentRoute";
import { AdminAccountPage } from "./pages/AdminAccountPage";
import { AdminForgotPasswordPage } from "./pages/AdminForgotPasswordPage";
import { AdminResetPasswordPage } from "./pages/AdminResetPasswordPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AssessorPracticalPage } from "./pages/AssessorPracticalPage";
import { AssessorReviewPage } from "./pages/AssessorReviewPage";
import { AssignmentsPage } from "./pages/AssignmentsPage";
import { CohortsPage } from "./pages/CohortsPage";
import { ModerationDetailPage } from "./pages/ModerationDetailPage";
import { ModerationPage } from "./pages/ModerationPage";
import { EvidenceDetailPage } from "./pages/EvidenceDetailPage";
import { EvidencePage } from "./pages/EvidencePage";
import { ProctoringMonitorPage } from "./pages/ProctoringMonitorPage";
import { ProctoringSetupPage } from "./pages/student/ProctoringSetupPage";
import { ResultsPage } from "./pages/ResultsPage";
import { ExamsPage } from "./pages/ExamsPage";
import { StudentsPage } from "./pages/StudentsPage";
import { McqExamPage } from "./pages/student/McqExamPage";
import { PracticalExamPage } from "./pages/student/PracticalExamPage";
import { StudentHomePage } from "./pages/student/StudentHomePage";
import { StudentLoginPage } from "./pages/student/StudentLoginPage";

export default function App() {
  return (
    <Routes>
      <Route path="/admin/forgot-password" element={<AdminForgotPasswordPage />} />
      <Route path="/admin/reset-password" element={<AdminResetPasswordPage />} />
      <Route element={<AdminRoute />}>
        <Route path="/" element={<AdminLayout />}>
          <Route index element={<RoleHome />} />
          <Route path="account" element={<AdminAccountPage />} />
          <Route
            path="cohorts"
            element={
              <RequireRole route="cohorts">
                <CohortsPage />
              </RequireRole>
            }
          />
          <Route
            path="students"
            element={
              <RequireRole route="students">
                <StudentsPage />
              </RequireRole>
            }
          />
          <Route
            path="exams"
            element={
              <RequireRole route="exams">
                <ExamsPage />
              </RequireRole>
            }
          />
          <Route
            path="assignments"
            element={
              <RequireRole route="assignments">
                <AssignmentsPage />
              </RequireRole>
            }
          />
          <Route
            path="results"
            element={
              <RequireRole route="results">
                <ResultsPage />
              </RequireRole>
            }
          />
          <Route
            path="moderation"
            element={
              <RequireRole route="moderation">
                <ModerationPage />
              </RequireRole>
            }
          />
          <Route
            path="moderation/:assignmentId"
            element={
              <RequireRole route="moderation">
                <ModerationDetailPage />
              </RequireRole>
            }
          />
          <Route
            path="proctoring"
            element={
              <RequireRole route="proctoring">
                <ProctoringMonitorPage />
              </RequireRole>
            }
          />
          <Route
            path="evidence"
            element={
              <RequireRole route="evidence">
                <EvidencePage />
              </RequireRole>
            }
          />
          <Route
            path="evidence/:assignmentId"
            element={
              <RequireRole route="evidence">
                <EvidenceDetailPage />
              </RequireRole>
            }
          />
          <Route
            path="assessor/practical"
            element={
              <RequireRole route="assessor">
                <AssessorPracticalPage />
              </RequireRole>
            }
          />
          <Route
            path="assessor/practical/:assignmentId"
            element={
              <RequireRole route="assessor">
                <AssessorReviewPage />
              </RequireRole>
            }
          />
          <Route
            path="admin/users"
            element={
              <RequireRole route="adminUsers">
                <AdminUsersPage />
              </RequireRole>
            }
          />
          <Route path="unauthorized" element={<Unauthorized />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
      <Route path="/student/login" element={<StudentLoginPage />} />
      <Route path="/student" element={<StudentRoute />}>
        <Route index element={<StudentHomePage />} />
        <Route path="exam/:assignmentId" element={<McqExamPage />} />
        <Route path="practical/:assignmentId" element={<PracticalExamPage />} />
        <Route path="proctoring/:assignmentId" element={<ProctoringSetupPage />} />
      </Route>
    </Routes>
  );
}
