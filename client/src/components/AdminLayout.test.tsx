import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { AdminAuthProvider } from "../admin/AdminAuthContext";
import * as api from "../api";
import type { AdminIdentity, AdminRole } from "../types";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof api>("../api");
  return { ...actual, fetchAdminMe: vi.fn(), logoutAdmin: vi.fn() };
});

function identity(role: AdminRole): AdminIdentity {
  return { id: "a1", email: "a@example.com", fullName: "Ada Admin", role };
}

function renderLayoutAs(role: AdminRole) {
  vi.mocked(api.fetchAdminMe).mockResolvedValue(identity(role));
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AdminAuthProvider>
        <Routes>
          <Route path="/" element={<AdminLayout />}>
            <Route index element={<p>Page content</p>} />
          </Route>
        </Routes>
      </AdminAuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminLayout — role-based nav", () => {
  it("SUPER_ADMIN sees every nav link, including Administrators", async () => {
    renderLayoutAs("SUPER_ADMIN");
    await waitFor(() => expect(screen.getByText(/page content/i)).toBeInTheDocument());

    for (const label of [
      "Dashboard",
      "Cohorts",
      "Students",
      "Exams",
      "Assignments",
      "Assessor",
      "Results",
      "Moderation",
      "Proctoring",
      "Evidence",
      "Administrators",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("ADMIN sees student/exam/cohort management links but not Assessor, Moderation, or Administrators", async () => {
    renderLayoutAs("ADMIN");
    await waitFor(() => expect(screen.getByText(/page content/i)).toBeInTheDocument());

    for (const label of ["Dashboard", "Cohorts", "Students", "Exams", "Assignments", "Results", "Proctoring", "Evidence"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    for (const label of ["Assessor", "Moderation", "Administrators"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });

  it("ASSESSOR sees only the Assessor link among the role-gated nav items", async () => {
    renderLayoutAs("ASSESSOR");
    await waitFor(() => expect(screen.getByText(/page content/i)).toBeInTheDocument());

    expect(screen.getByRole("link", { name: "Assessor" })).toBeInTheDocument();
    for (const label of ["Dashboard", "Cohorts", "Students", "Exams", "Moderation", "Administrators"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });

  it("MODERATOR sees only the Moderation link among the role-gated nav items", async () => {
    renderLayoutAs("MODERATOR");
    await waitFor(() => expect(screen.getByText(/page content/i)).toBeInTheDocument());

    expect(screen.getByRole("link", { name: "Moderation" })).toBeInTheDocument();
    for (const label of ["Dashboard", "Cohorts", "Assessor", "Administrators"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });

  it("displays the signed-in admin's identity and signs out on click", async () => {
    const user = userEvent.setup();
    vi.mocked(api.logoutAdmin).mockResolvedValue(undefined);
    renderLayoutAs("ADMIN");
    await waitFor(() => expect(screen.getByText(/page content/i)).toBeInTheDocument());

    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText(/a@example\.com · ADMIN/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(api.logoutAdmin).toHaveBeenCalled();
  });
});
