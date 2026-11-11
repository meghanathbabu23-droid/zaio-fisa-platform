import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AdminLoginPage } from "./AdminLoginPage";
import * as api from "../api";

function renderLoginPage(onLoggedIn: () => void) {
  return render(
    <MemoryRouter>
      <AdminLoginPage onLoggedIn={onLoggedIn} />
    </MemoryRouter>
  );
}

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof api>("../api");
  return { ...actual, loginAdmin: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminLoginPage", () => {
  it("shows a validation message for an empty submit, without calling the API", async () => {
    const user = userEvent.setup();
    renderLoginPage(() => {});
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/enter your email and password/i)).toBeInTheDocument();
    expect(api.loginAdmin).not.toHaveBeenCalled();
  });

  it("shows the server's error message and does not call onLoggedIn on invalid credentials", async () => {
    const user = userEvent.setup();
    vi.mocked(api.loginAdmin).mockRejectedValue(new Error("Invalid email or password."));
    const onLoggedIn = vi.fn();
    renderLoginPage(onLoggedIn);

    await user.type(screen.getByLabelText(/email/i), "wrong@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
    expect(onLoggedIn).not.toHaveBeenCalled();
  });

  it("shows distinct lockout feedback on a 423-style locked-account message", async () => {
    const user = userEvent.setup();
    vi.mocked(api.loginAdmin).mockRejectedValue(new Error("Account temporarily locked. Try again later."));
    renderLoginPage(() => {});

    await user.type(screen.getByLabelText(/email/i), "locked@example.com");
    await user.type(screen.getByLabelText(/password/i), "whatever");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/temporarily locked/i)).toBeInTheDocument();
  });

  it("calls onLoggedIn when credentials are correct", async () => {
    const user = userEvent.setup();
    vi.mocked(api.loginAdmin).mockResolvedValue({
      id: "a1",
      email: "admin@example.com",
      fullName: "Ada Admin",
      role: "ADMIN",
    });
    const onLoggedIn = vi.fn();
    renderLoginPage(onLoggedIn);

    await user.type(screen.getByLabelText(/email/i), "admin@example.com");
    await user.type(screen.getByLabelText(/password/i), "correct-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
  });

  it("uses a password-style input so the password isn't visible on screen", () => {
    renderLoginPage(() => {});
    const input = screen.getByLabelText(/password/i) as HTMLInputElement;
    expect(input.type).toBe("password");
  });

  it("shows a loading state while the login call is in flight", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    vi.mocked(api.loginAdmin).mockReturnValue(new Promise((r) => (resolve = r)));
    renderLoginPage(() => {});

    await user.type(screen.getByLabelText(/email/i), "admin@example.com");
    await user.type(screen.getByLabelText(/password/i), "some-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("button", { name: /signing in/i })).toBeDisabled();
    resolve({ id: "a1", email: "admin@example.com", fullName: "Ada Admin", role: "ADMIN" });
  });
});
