import { Navigate } from "react-router-dom";
import { useAdminAuth } from "../admin/AdminAuthContext";
import { canAccess, homePathFor } from "../admin/rolePermissions";
import { DashboardPage } from "../pages/DashboardPage";

/** The "/" route: shows the Dashboard for roles that can use it (it calls
 * cohorts/students/exams/assignments), otherwise sends ASSESSOR/MODERATOR
 * straight to the page their role actually works in. */
export function RoleHome() {
  const { admin } = useAdminAuth();
  if (!admin) return null;
  if (canAccess(admin.role, "dashboard")) {
    return <DashboardPage />;
  }
  return <Navigate to={homePathFor(admin.role)} replace />;
}
