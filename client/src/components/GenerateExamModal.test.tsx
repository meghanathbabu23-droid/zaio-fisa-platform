import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenerateExamModal } from "./GenerateExamModal";
import * as api from "../api";
import type { GenerationOutcome } from "../types";

vi.mock("../api", () => ({
  generateExamQuestions: vi.fn(),
}));

function renderModal(onClose = vi.fn(), onGenerated = vi.fn()) {
  render(<GenerateExamModal cohorts={[]} onClose={onClose} onGenerated={onGenerated} />);
  return { onClose, onGenerated };
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText(/FISA HTML Programmer/i), "FISA HTML Programmer (SP-230372)");
  await user.type(screen.getByPlaceholderText(/Mock Assessment 3/i), "Mock Assessment 3");
  await user.type(screen.getByPlaceholderText(/Add a topic/i), "Flexbox");
  await user.click(screen.getByRole("button", { name: "Add" }));
}

const successOutcome: GenerationOutcome = {
  kind: "success",
  jobId: "job-1",
  exam: {
    id: "exam-1",
    title: "FISA HTML Programmer (SP-230372) — Mock Assessment 3",
    type: "MCQ",
    durationMinutes: 45,
    instructions: "",
    isActive: false,
    totalMarks: 100,
    cohortId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questions: [
      { id: "q1", examId: "exam-1", prompt: "What is semantic HTML?", options: ["A", "B", "C", "D"], correctIndex: 1, marks: 50, sortOrder: 0 },
      { id: "q2", examId: "exam-1", prompt: "What is Flexbox?", options: ["A", "B", "C", "D"], correctIndex: 0, marks: 50, sortOrder: 1 },
    ],
  },
  topicCoverage: { Flexbox: 2 },
  difficultyDistribution: { EASY: 1, MEDIUM: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GenerateExamModal — form validation", () => {
  it("blocks submission and shows a message when difficulty percentages don't sum to 100", async () => {
    const user = userEvent.setup();
    renderModal();
    await fillRequiredFields(user);

    const [easy] = screen.getAllByText(/^EASY$/).map((el) => el.parentElement!.querySelector("input")!);
    await user.clear(easy);
    await user.type(easy, "10");

    await user.click(screen.getByRole("button", { name: "Generate exam" }));
    expect(await screen.findByText(/must sum to 100/i)).toBeInTheDocument();
    expect(api.generateExamQuestions).not.toHaveBeenCalled();
  });

  it("requires at least one topic before submitting", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByPlaceholderText(/FISA HTML Programmer/i), "Some qualification");
    await user.type(screen.getByPlaceholderText(/Mock Assessment 3/i), "Some title");

    await user.click(screen.getByRole("button", { name: "Generate exam" }));
    expect(await screen.findByText(/Add at least one topic/i)).toBeInTheDocument();
    expect(api.generateExamQuestions).not.toHaveBeenCalled();
  });
});

describe("GenerateExamModal — submission and duplicate-submit prevention", () => {
  it("disables the submit button while a request is in flight, preventing a duplicate submission", async () => {
    const user = userEvent.setup();
    let resolveCall: (v: GenerationOutcome) => void = () => {};
    vi.mocked(api.generateExamQuestions).mockReturnValue(
      new Promise((resolve) => {
        resolveCall = resolve;
      })
    );
    renderModal();
    await fillRequiredFields(user);

    const submitButton = screen.getByRole("button", { name: "Generate exam" });
    await user.click(submitButton);

    expect(await screen.findByRole("button", { name: /Generating/i })).toBeDisabled();
    // A second click while disabled must not trigger a second call.
    await user.click(screen.getByRole("button", { name: /Generating/i }));
    expect(api.generateExamQuestions).toHaveBeenCalledTimes(1);

    resolveCall(successOutcome);
    await screen.findByText(/Exam generated/i);
  });

  it("calls generateExamQuestions with the combined qualification/title and the configured fields", async () => {
    const user = userEvent.setup();
    vi.mocked(api.generateExamQuestions).mockResolvedValue(successOutcome);
    renderModal();
    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: "Generate exam" }));

    await waitFor(() =>
      expect(api.generateExamQuestions).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "MCQ",
          title: "FISA HTML Programmer (SP-230372) — Mock Assessment 3",
          topics: ["Flexbox"],
        })
      )
    );
  });
});

describe("GenerateExamModal — success summary and review", () => {
  it("shows the generated exam summary, topic coverage, difficulty distribution and marks, and lets the admin review questions before it's active", async () => {
    const user = userEvent.setup();
    vi.mocked(api.generateExamQuestions).mockResolvedValue(successOutcome);
    renderModal();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Generate exam" }));

    await screen.findByText(/Exam generated/i);
    expect(screen.getByText(/not active/i)).toBeInTheDocument();
    expect(screen.getByText("Flexbox: 2")).toBeInTheDocument();
    expect(screen.getByText("EASY: 1")).toBeInTheDocument();
    expect(screen.getByText("MEDIUM: 1")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument(); // total marks

    await user.click(screen.getByRole("button", { name: /Review generated questions/i }));
    expect(screen.getByText(/What is semantic HTML\?/)).toBeInTheDocument();
    expect(screen.getByText(/What is Flexbox\?/)).toBeInTheDocument();
  });

  it("calls onGenerated and onClose when Done is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(api.generateExamQuestions).mockResolvedValue(successOutcome);
    const { onClose, onGenerated } = renderModal();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Generate exam" }));
    await screen.findByText(/Exam generated/i);

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onGenerated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("GenerateExamModal — error handling per status code", () => {
  it("shows a clear message when AI generation is not configured (503)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.generateExamQuestions).mockResolvedValue({ kind: "not_configured", error: "AI generation is not configured" });
    renderModal();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Generate exam" }));
    expect(await screen.findByText(/not configured on the server/i)).toBeInTheDocument();
  });

  it("shows a clear message when a generation job is already running (409)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.generateExamQuestions).mockResolvedValue({ kind: "locked", error: "A generation job is already running for this admin" });
    renderModal();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Generate exam" }));
    expect(await screen.findByText(/already running/i)).toBeInTheDocument();
  });

  it("shows unresolved slots when uniqueness couldn't be achieved (422)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.generateExamQuestions).mockResolvedValue({
      kind: "insufficient_uniqueness",
      error: "Could not generate enough unique questions",
      unresolvedSlots: [{ topic: "Flexbox", difficulty: "HARD" }],
    });
    renderModal();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Generate exam" }));
    expect(await screen.findByText(/Could not generate enough genuinely unique/i)).toBeInTheDocument();
    expect(screen.getByText(/Flexbox \(HARD\)/)).toBeInTheDocument();
  });

  it("surfaces the server's own validation message for a 400", async () => {
    const user = userEvent.setup();
    vi.mocked(api.generateExamQuestions).mockResolvedValue({ kind: "invalid", error: "totalMarks must be a positive integer" });
    renderModal();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Generate exam" }));
    expect(await screen.findByText(/totalMarks must be a positive integer/i)).toBeInTheDocument();
  });

  it("never renders any AI provider credential or raw prompt text in the DOM", async () => {
    const user = userEvent.setup();
    vi.mocked(api.generateExamQuestions).mockResolvedValue(successOutcome);
    renderModal();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Generate exam" }));
    await screen.findByText(/Exam generated/i);
    expect(document.body.innerHTML).not.toMatch(/sk-ant-|ANTHROPIC_API_KEY|VOYAGE_API_KEY/i);
  });
});
