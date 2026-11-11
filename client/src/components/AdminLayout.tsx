import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Logo } from "./ui/Logo";
import { useAdminAuth } from "../admin/AdminAuthContext";
import { canAccess, type RouteKey } from "../admin/rolePermissions";
import type { AdminRole } from "../types";

const nav: { to: string; label: string; end: boolean; route: RouteKey }[] = [
  { to: "/", label: "Dashboard", end: true, route: "dashboard" },
  { to: "/cohorts", label: "Cohorts", end: false, route: "cohorts" },
  { to: "/students", label: "Students", end: false, route: "students" },
  { to: "/exams", label: "Exams", end: false, route: "exams" },
  { to: "/assignments", label: "Assignments", end: false, route: "assignments" },
  { to: "/assessor/practical", label: "Assessor", end: false, route: "assessor" },
  { to: "/results", label: "Results", end: false, route: "results" },
  { to: "/moderation", label: "Moderation", end: false, route: "moderation" },
  { to: "/proctoring", label: "Proctoring", end: false, route: "proctoring" },
  { to: "/evidence", label: "Evidence", end: false, route: "evidence" },
  { to: "/admin/users", label: "Administrators", end: false, route: "adminUsers" },
];

function Brand() {
  return (
    <div className="border-b border-zaio-cloud px-6 py-5">
      <Logo />
      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-zaio-slate">FISA admin</p>
    </div>
  );
}

function NavLinks({ role, onNavigate }: { role: AdminRole; onNavigate?: () => void }) {
  return (
    <>
      {nav
        .filter((item) => canAccess(role, item.route))
        .map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              [
                "rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150",
                isActive
                  ? "bg-zaio-blue text-white shadow-sm"
                  : "text-zaio-graphite hover:bg-zaio-mist hover:text-zaio-ink",
              ].join(" ")
            }
          >
            {item.label}
          </NavLink>
        ))}
    </>
  );
}

function SidebarFooter({ onNavigate }: { onNavigate?: () => void }) {
  const { admin, logout } = useAdminAuth();
  return (
    <div className="space-y-2 border-t border-zaio-cloud p-4">
      {admin ? (
        <>
          <p className="truncate text-xs font-medium text-zaio-ink">{admin.fullName}</p>
          <p className="truncate text-xs text-zaio-ink/50">
            {admin.email} · {admin.role}
          </p>
        </>
      ) : null}
      <NavLink
        to="/account"
        onClick={onNavigate}
        className="block text-xs font-medium text-zaio-blue hover:underline"
      >
        Your account
      </NavLink>
      <a href="/student/login" className="block text-xs font-medium text-zaio-blue hover:underline">
        Student OTP login →
      </a>
      <button
        type="button"
        className="block text-xs font-medium text-zaio-ink/60 hover:text-zaio-ink"
        onClick={() => logout()}
      >
        Sign out
      </button>
    </div>
  );
}

export function AdminLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { admin } = useAdminAuth();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  if (!admin) return null;

  return (
    <div className="flex min-h-screen bg-zaio-paper">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-zaio-cloud bg-white lg:flex">
        <Brand />
        <nav className="flex flex-1 flex-col gap-1 p-4">
          <NavLinks role={admin.role} />
        </nav>
        <SidebarFooter />
      </aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-zaio-ink/40"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="relative flex h-full w-64 max-w-[85vw] flex-col bg-white shadow-xl">
            <Brand />
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-4">
              <NavLinks role={admin.role} onNavigate={() => setMenuOpen(false)} />
            </nav>
            <SidebarFooter onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-zaio-cloud bg-white px-4 py-3 lg:hidden">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
            className="rounded-xl border border-zaio-cloud px-3 py-1.5 text-sm font-medium text-zaio-ink transition-colors hover:bg-zaio-paper"
          >
            Menu
          </button>
          <Logo variant="mark" />
        </div>
        <main className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
