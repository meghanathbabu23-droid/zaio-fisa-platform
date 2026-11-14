import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { StudentLoginPage } from "./StudentLoginPage";
import * as api from "../../api";
import { getStudentToken, clearStudentToken } from "../../student/session";

vi.mock("../../api", () => ({
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
  registerTester: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <StudentLoginPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearStudentToken();
});

describe("StudentLoginPage — email flow", () => {
  it("shows only the email field and sends a code when submitted", async () => {
    const user = userEvent.setup();
    vi.mocked(api.requestOtp).mockResolvedValue({
      ok: true,
      message: "If that email is registered, a verification code has been sent.",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      cooldownSeconds: 60,
    });
    renderPage();

    await user.type(screen.getByLabelText(/Zaio email/i), "student@example.com");
    await user.click(screen.getByRole("button", { name: /send otp to email/i }));

    await waitFor(() => expect(api.requestOtp).toHaveBeenCalledWith("email", "student@example.com"));
    expect(await screen.findByLabelText(/Enter code/i)).toBeInTheDocument();
  });

  it("shows the server's own non-committal message, never a hardcoded confident delivery claim (the API never confirms delivery actually succeeded)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.requestOtp).mockResolvedValue({
      ok: true,
      message: "If that email is registered, a verification code has been sent.",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      cooldownSeconds: 60,
    });
    renderPage();
    await user.type(screen.getByLabelText(/Zaio email/i), "student@example.com");
    await user.click(screen.getByRole("button", { name: /send otp to email/i }));

    await screen.findByLabelText(/Enter code/i);
    expect(screen.getByText(/If that email is registered, a verification code has been sent\./i)).toBeInTheDocument();
    // "We sent a 6-digit code" would wrongly assert delivery succeeded —
    // the backend never guarantees that, even on its own success path.
    expect(screen.queryByText(/^We sent a 6-digit code/i)).not.toBeInTheDocument();
  });

  it("never renders an OTP code anywhere on screen — only a generic confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(api.requestOtp).mockResolvedValue({
      ok: true,
      message: "ok",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      cooldownSeconds: 60,
    });
    renderPage();
    await user.type(screen.getByLabelText(/Zaio email/i), "student@example.com");
    await user.click(screen.getByRole("button", { name: /send otp to email/i }));

    await screen.findByLabelText(/Enter code/i);
    expect(screen.queryByText(/\b\d{6}\b/)).not.toBeInTheDocument();
  });

  it("verifying with the entered code stores the returned session token and navigates", async () => {
    const user = userEvent.setup();
    vi.mocked(api.requestOtp).mockResolvedValue({
      ok: true,
      message: "ok",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      cooldownSeconds: 60,
    });
    vi.mocked(api.verifyOtp).mockResolvedValue({
      token: "a-real-session-token",
      student: { id: "s1", firstName: "Amahle", lastName: "D", email: "student@example.com" },
    });
    renderPage();
    await user.type(screen.getByLabelText(/Zaio email/i), "student@example.com");
    await user.click(screen.getByRole("button", { name: /send otp to email/i }));

    const codeInput = await screen.findByLabelText(/Enter code/i);
    await user.type(codeInput, "123456");
    await user.click(screen.getByRole("button", { name: /verify & continue/i }));

    await waitFor(() => expect(api.verifyOtp).toHaveBeenCalledWith("email", "student@example.com", "123456"));
    await waitFor(() => expect(getStudentToken()).toBe("a-real-session-token"));
  });
});

describe("StudentLoginPage — phone login is unavailable", () => {
  it("renders no phone/SMS tab or input anywhere on the identity step", async () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "Phone" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Phone number/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send code via sms/i })).not.toBeInTheDocument();
  });

  it("only ever requests the OTP via the email channel", async () => {
    const user = userEvent.setup();
    vi.mocked(api.requestOtp).mockResolvedValue({
      ok: true,
      message: "ok",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      cooldownSeconds: 60,
    });
    renderPage();

    await user.type(screen.getByLabelText(/Zaio email/i), "student@example.com");
    await user.click(screen.getByRole("button", { name: /send otp to email/i }));

    await waitFor(() => expect(api.requestOtp).toHaveBeenCalledWith("email", "student@example.com"));
    expect(api.requestOtp).not.toHaveBeenCalledWith("phone", expect.anything());
  });
});

describe("StudentLoginPage — resend cooldown", () => {
  it("disables and labels the resend button with a countdown immediately after requesting", async () => {
    const user = userEvent.setup();
    vi.mocked(api.requestOtp).mockResolvedValue({
      ok: true,
      message: "ok",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      cooldownSeconds: 60,
    });
    renderPage();
    await user.type(screen.getByLabelText(/Zaio email/i), "student@example.com");
    await user.click(screen.getByRole("button", { name: /send otp to email/i }));

    const resendButton = await screen.findByRole("button", { name: /resend code in \d+s/i });
    expect(resendButton).toBeDisabled();
  });
});

describe("StudentLoginPage — error states", () => {
  it("shows the server's error message when the request fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.requestOtp).mockRejectedValue(new Error("Too many requests. Please wait and try again."));
    renderPage();
    await user.type(screen.getByLabelText(/Zaio email/i), "student@example.com");
    await user.click(screen.getByRole("button", { name: /send otp to email/i }));

    expect(await screen.findByText("Too many requests. Please wait and try again.")).toBeInTheDocument();
  });

  it("shows a validation message when submitting with an empty identifier", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /send otp to email/i }));
    expect(await screen.findByText(/enter your registered zaio email/i)).toBeInTheDocument();
    expect(api.requestOtp).not.toHaveBeenCalled();
  });

  it("shows the server's error message when verification fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.requestOtp).mockResolvedValue({
      ok: true,
      message: "ok",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      cooldownSeconds: 60,
    });
    vi.mocked(api.verifyOtp).mockRejectedValue(new Error("Invalid code. Please request a new one."));
    renderPage();
    await user.type(screen.getByLabelText(/Zaio email/i), "student@example.com");
    await user.click(screen.getByRole("button", { name: /send otp to email/i }));
    const codeInput = await screen.findByLabelText(/Enter code/i);
    await user.type(codeInput, "000000");
    await user.click(screen.getByRole("button", { name: /verify & continue/i }));

    expect(await screen.findByText("Invalid code. Please request a new one.")).toBeInTheDocument();
  });
});

describe("StudentLoginPage — tester self-registration", () => {
  it("registers a new tester, then returns to sign-in with the email pre-filled", async () => {
    const user = userEvent.setup();
    vi.mocked(api.registerTester).mockResolvedValue({
      ok: true,
      reused: false,
      student: { id: "t1", firstName: "New", lastName: "Tester", email: "new.tester@example.com", phone: "+27821119999" },
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: /new tester\? register here/i }));
    await user.type(screen.getByLabelText(/full name/i), "New Tester");
    await user.type(screen.getByLabelText(/^email$/i), "new.tester@example.com");
    await user.type(screen.getByLabelText(/mobile number/i), "082 111 9999");
    await user.click(screen.getByRole("button", { name: /^register$/i }));

    await waitFor(() =>
      expect(api.registerTester).toHaveBeenCalledWith("New Tester", "new.tester@example.com", "082 111 9999")
    );
    expect(await screen.findByLabelText(/Zaio email/i)).toHaveValue("new.tester@example.com");
    expect(await screen.findByText(/registered\. request your code below/i)).toBeInTheDocument();
  });

  it("shows a distinct message when the identity is already registered (reused, not duplicated)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.registerTester).mockResolvedValue({
      ok: true,
      reused: true,
      student: { id: "t1", firstName: "Existing", lastName: "Tester", email: "existing@example.com", phone: "+27821119998" },
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: /new tester\? register here/i }));
    await user.type(screen.getByLabelText(/full name/i), "Existing Tester");
    await user.type(screen.getByLabelText(/^email$/i), "existing@example.com");
    await user.type(screen.getByLabelText(/mobile number/i), "082 111 9998");
    await user.click(screen.getByRole("button", { name: /^register$/i }));

    expect(await screen.findByText(/already registered to an existing tester record/i)).toBeInTheDocument();
  });

  it("shows a validation message when submitting registration with missing fields", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /new tester\? register here/i }));
    await user.click(screen.getByRole("button", { name: /^register$/i }));

    expect(await screen.findByText(/full name, email, and mobile number are all required/i)).toBeInTheDocument();
    expect(api.registerTester).not.toHaveBeenCalled();
  });

  it("shows the server's error (e.g. feature disabled, or a conflicting record) and does not proceed", async () => {
    const user = userEvent.setup();
    vi.mocked(api.registerTester).mockRejectedValue(new Error("Not found"));
    renderPage();
    await user.click(screen.getByRole("button", { name: /new tester\? register here/i }));
    await user.type(screen.getByLabelText(/full name/i), "New Tester");
    await user.type(screen.getByLabelText(/^email$/i), "new.tester@example.com");
    await user.type(screen.getByLabelText(/mobile number/i), "082 111 9999");
    await user.click(screen.getByRole("button", { name: /^register$/i }));

    expect(await screen.findByText("Not found")).toBeInTheDocument();
  });

  it("'Back to sign in' returns to the identity form without registering", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /new tester\? register here/i }));
    await user.click(screen.getByRole("button", { name: /back to sign in/i }));

    expect(screen.getByLabelText(/Zaio email/i)).toBeInTheDocument();
    expect(api.registerTester).not.toHaveBeenCalled();
  });
});
