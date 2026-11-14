import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { getStudentToken } from "../student/session";
import { resumePendingProctoringUploads } from "../student/proctoringHelpers";

export function StudentRoute() {
  // Runs once whenever this layout mounts — on a hard page refresh while
  // already logged in, and right after navigating in from /student/login.
  // Gated on an authenticated token (resumePendingProctoringUploads also
  // checks for a studentId itself, so this is defense-in-depth, not the
  // only guard) and never interferes with anything if there's nothing
  // pending — see resumePendingProctoringUploads' own doc comment for the
  // duplicate-call and active-session-exclusion guarantees.
  useEffect(() => {
    if (getStudentToken()) {
      void resumePendingProctoringUploads();
    }
  }, []);

  if (!getStudentToken()) {
    return <Navigate to="/student/login" replace />;
  }
  return <Outlet />;
}
