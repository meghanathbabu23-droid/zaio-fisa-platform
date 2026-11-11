import { Navigate, Outlet } from "react-router-dom";
import { getStudentToken } from "../student/session";

export function StudentRoute() {
  if (!getStudentToken()) {
    return <Navigate to="/student/login" replace />;
  }
  return <Outlet />;
}
