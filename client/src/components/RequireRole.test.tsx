import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RequireRole } from "./RequireRole";
import { AdminAuthProvider } from "../admin/AdminAuthContext";
import * as api from "../api";
import type { AdminIdentity } from "../types";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof api>("../api");
  return { ...actual, fetchAdminMe: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
});

function renderGuarded(admin: AdminIdentity) {
  vi.mocked(api.fetchAdminMe).mockResolvedValue(admin);
  return render(
    <MemoryRouter>
      <AdminAuthProvider>
        <RequireRole route="adminUsers">
          <p>Super admin only content</p>
        </RequireRole>
      </AdminAuthProvider>
    </MemoryRouter>
  );
}

describe("RequireRole", () => {
  it("renders the guarded content for a permitted role", async () => {
    renderGuarded({ id: "a1", email: "a@example.com", fullName: "Ada Admin", role: "SUPER_ADMIN" });
    expect(await screen.findByText(/super admin only content/i)).toBeInTheDocument();
  });

  it("renders the Unauthorized page for a role without access, naming that role", async () => {
    renderGuarded({ id: "a2", email: "b@example.com", fullName: "Bo Admin", role: "ADMIN" });
    expect(await screen.findByText(/your role \(ADMIN\) doesn't have access/i)).toBeInTheDocument();
    expect(screen.queryByText(/super admin only content/i)).not.toBeInTheDocument();
  });

  it("links back to that role's own home page from the Unauthorized screen", async () => {
    renderGuarded({ id: "a3", email: "c@example.com", fullName: "Cy Admin", role: "ASSESSOR" });
    await waitFor(() => expect(screen.getByRole("link", { name: /go to your dashboard/i })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /go to your dashboard/i })).toHaveAttribute(
      "href",
      "/assessor/practical"
    );
  });
});
