import { Link } from "react-router-dom";
import { useAdminAuth } from "../admin/AdminAuthContext";
import { homePathFor } from "../admin/rolePermissions";
import { StateBanner } from "./ui/StateBanner";

export function Unauthorized() {
  const { admin } = useAdminAuth();
  const home = admin ? homePathFor(admin.role) : "/";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <StateBanner tone="warning" className="max-w-md">
        Your role ({admin?.role ?? "unknown"}) doesn't have access to this page.
      </StateBanner>
      <Link to={home} className="text-sm font-medium text-zaio-blue hover:underline">
        Go to your dashboard →
      </Link>
    </div>
  );
}
