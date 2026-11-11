import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdminRoute } from "./AdminRoute";
import { ADMIN_UNAUTHORIZED_EVENT } from "../admin/session";
import * as api from "../api";
import type { AdminIdentity } from "../types";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof api>("../api");
  return { ...actual, fetchAdminMe: vi.fn(), loginAdmin: vi.fn(), logoutAdmin: vi.fn() };
});

const ADMIN: AdminIdentity = { id: "a1", email: "a@example.com", fullName: "Ada Admin", role: "ADMIN" };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderAdminRoute() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AdminRoute />}>
          <Route path="/" element={<p>Admin dashboard content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("AdminRoute", () => {
  it("shows a loading state, then the login screen when there is no session", async () => {
    vi.mocked(api.fetchAdminMe).mockRejectedValue(new Error("Admin authentication required"));
    renderAdminRoute();
    expect(screen.getByText(/checking session/i)).toBeInTheDocument();

    expect(await screen.findByText(/admin sign in/i)).toBeInTheDocument();
    expect(screen.queryByText(/admin dashboard content/i)).not.toBeInTheDocument();
  });

  it("renders the protected content when a session already exists", async () => {
    vi.mocked(api.fetchAdminMe).mockResolvedValue(ADMIN);
    renderAdminRoute();

    expect(await screen.findByText(/admin dashboard content/i)).toBeInTheDocument();
    expect(screen.queryByText(/admin sign in/i)).not.toBeInTheDocument();
  });

  it("falls back to the login screen when an ADMIN_UNAUTHORIZED_EVENT fires (expired/revoked session caught by adminFetch)", async () => {
    vi.mocked(api.fetchAdminMe).mockResolvedValue(ADMIN);
    renderAdminRoute();
    expect(await screen.findByText(/admin dashboard content/i)).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event(ADMIN_UNAUTHORIZED_EVENT));
    });

    await waitFor(() => expect(screen.getByText(/admin sign in/i)).toBeInTheDocument());
    expect(screen.queryByText(/admin dashboard content/i)).not.toBeInTheDocument();
  });

  it("re-checks the session and shows protected content after a successful login", async () => {
    vi.mocked(api.fetchAdminMe).mockRejectedValueOnce(new Error("Admin authentication required"));
    renderAdminRoute();
    expect(await screen.findByText(/admin sign in/i)).toBeInTheDocument();

    vi.mocked(api.loginAdmin).mockResolvedValue(ADMIN);
    vi.mocked(api.fetchAdminMe).mockResolvedValue(ADMIN);

    const user = (await import("@testing-library/user-event")).default.setup();
    await user.type(screen.getByLabelText(/email/i), ADMIN.email);
    await user.type(screen.getByLabelText(/password/i), "Some-Strong-Pass1!");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/admin dashboard content/i)).toBeInTheDocument();
  });
});
