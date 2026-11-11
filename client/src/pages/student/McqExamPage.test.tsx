import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { McqExamPage } from "./McqExamPage";
import * as api from "../../api";
import * as proctoring from "../../student/proctoringHelpers";

vi.mock("../../api", () => ({
  startMcqExam: vi.fn(),
  loadMcqExam: vi.fn(),
  submitMcqExam: vi.fn(),
}));

vi.mock("../../student/proctoringHelpers", () => ({
  bindProctoringExamMonitors: vi.fn(() => () => {}),
  logProctoringEvent: vi.fn(),
  uploadAndEndProctoring: vi.fn(),
}));

const QUESTIONS = [
  { id: "q1", prompt: "What tag defines a hyperlink?", options: ["<div>", "<a>", "<span>", "<p>"] },
  { id: "q2", prompt: "Which property sets text color?", options: ["color", "background", "font", "size"] },
  { id: "q3", prompt: "Which value makes a flex container?", options: ["grid", "flex", "block", "inline"] },
];

function mockExam() {
  vi.mocked(api.startMcqExam).mockResolvedValue({
    remainingSeconds: 600,
    durationMinutes: 45,
    startedAt: new Date().toISOString(),
  });
  vi.mocked(api.loadMcqExam).mockResolvedValue({
    title: "FISA Knowledge Assessment",
    instructions: "Answer every question.",
    durationMinutes: 45,
    remainingSeconds: 600,
    questions: QUESTIONS,
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/student/exam/a1"]}>
      <Routes>
        <Route path="/student/exam/:assignmentId" element={<McqExamPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("McqExamPage — one-question-at-a-time navigation and progress", () => {
  it("shows the first question with a progress indicator and an empty answered count", async () => {
    mockExam();
    renderPage();

    expect(await screen.findByText(/question 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByText(/0\/3 answered/i)).toBeInTheDocument();
    expect(screen.getByText(/what tag defines a hyperlink/i)).toBeInTheDocument();
    expect(screen.queryByText(/which property sets text color/i)).not.toBeInTheDocument();
  });

  it("Next advances to the next question; Previous is disabled on the first question", async () => {
    const user = userEvent.setup();
    mockExam();
    renderPage();
    await screen.findByText(/question 1 of 3/i);

    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^next$/i }));
    expect(await screen.findByText(/question 2 of 3/i)).toBeInTheDocument();
    expect(screen.getByText(/which property sets text color/i)).toBeInTheDocument();
  });

  it("selecting an answer updates the answered count and the per-question navigator", async () => {
    const user = userEvent.setup();
    mockExam();
    renderPage();
    await screen.findByText(/question 1 of 3/i);

    await user.click(screen.getByLabelText("<a>"));
    expect(await screen.findByText(/1\/3 answered/i)).toBeInTheDocument();
  });

  it("clicking a question-number pill jumps directly to that question", async () => {
    const user = userEvent.setup();
    mockExam();
    renderPage();
    await screen.findByText(/question 1 of 3/i);

    await user.click(screen.getByRole("button", { name: /go to question 3/i }));
    expect(await screen.findByText(/question 3 of 3/i)).toBeInTheDocument();
    expect(screen.getByText(/which value makes a flex container/i)).toBeInTheDocument();
  });

  it("shows Submit instead of Next on the last question", async () => {
    const user = userEvent.setup();
    mockExam();
    renderPage();
    await screen.findByText(/question 1 of 3/i);

    await user.click(screen.getByRole("button", { name: /go to question 3/i }));
    expect(screen.getByRole("button", { name: /submit answers/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^next$/i })).not.toBeInTheDocument();
  });

  it("submitting with unanswered questions shows a validation error and jumps to the first unanswered one", async () => {
    const user = userEvent.setup();
    mockExam();
    renderPage();
    await screen.findByText(/question 1 of 3/i);

    // Answer question 2 only, then jump to the last question and try to submit.
    await user.click(screen.getByRole("button", { name: /go to question 2/i }));
    await user.click(screen.getByLabelText("color"));
    await user.click(screen.getByRole("button", { name: /go to question 3/i }));
    await user.click(screen.getByRole("button", { name: /submit answers/i }));

    expect(await screen.findByText(/answer every question before submitting/i)).toBeInTheDocument();
    expect(await screen.findByText(/question 1 of 3/i)).toBeInTheDocument();
    expect(api.submitMcqExam).not.toHaveBeenCalled();
  });

  it("submitting with every question answered calls submitMcqExam and shows the result", async () => {
    const user = userEvent.setup();
    mockExam();
    vi.mocked(api.submitMcqExam).mockResolvedValue({
      scorePercent: 100,
      correct: 3,
      total: 3,
      autoMarked: true,
    });
    renderPage();
    await screen.findByText(/question 1 of 3/i);

    await user.click(screen.getByLabelText("<a>"));
    await user.click(screen.getByRole("button", { name: /go to question 2/i }));
    await user.click(screen.getByLabelText("color"));
    await user.click(screen.getByRole("button", { name: /go to question 3/i }));
    await user.click(screen.getByLabelText("flex"));
    await user.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => expect(api.submitMcqExam).toHaveBeenCalledWith("a1", [1, 0, 1]));
    expect(await screen.findByText(/exam submitted/i)).toBeInTheDocument();
    expect(proctoring.uploadAndEndProctoring).toHaveBeenCalled();
  });
});
