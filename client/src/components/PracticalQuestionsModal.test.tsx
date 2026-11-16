import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PracticalQuestionsModal } from "./PracticalQuestionsModal";
import * as api from "../api";
import type { PracticalQuestion } from "../types";

vi.mock("../api", () => ({
  createPracticalQuestion: vi.fn(),
  deletePracticalQuestion: vi.fn(),
  deletePracticalQuestionReferenceAsset: vi.fn(),
  fetchPracticalQuestionReferenceAssets: vi.fn(),
  fetchPracticalQuestions: vi.fn(),
  reorderPracticalQuestion: vi.fn(),
  updatePracticalQuestion: vi.fn(),
  uploadPracticalQuestionReferenceAsset: vi.fn(),
}));

function question(overrides: Partial<PracticalQuestion> = {}): PracticalQuestion {
  return {
    id: "q1",
    examId: "exam1",
    title: "Build a signup form",
    scenario: "A client needs a signup form",
    instructions: "Create index.html",
    requirements: ["Has a name field"],
    marks: 50,
    difficulty: "MEDIUM",
    sortOrder: 0,
    testCaseCount: 2,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(api.fetchPracticalQuestionReferenceAssets).mockResolvedValue([]);
});

function renderModal(questions: PracticalQuestion[], totalMarks: number | null = 100) {
  vi.mocked(api.fetchPracticalQuestions).mockResolvedValue(questions);
  const onClose = vi.fn();
  render(
    <PracticalQuestionsModal examId="exam1" examTitle="Test exam" totalMarks={totalMarks} onClose={onClose} />
  );
  return { onClose };
}

describe("PracticalQuestionsModal", () => {
  it("lists existing questions with their marks and test case count", async () => {
    renderModal([question()]);
    expect(await screen.findByText("Build a signup form")).toBeInTheDocument();
    expect(screen.getByText(/50 marks · 2 test cases/)).toBeInTheDocument();
  });

  it("shows a mismatched-marks banner in red and a matched one in green", async () => {
    renderModal([question({ marks: 40 })], 100);
    const banner = await screen.findByText(/Marks: 40 \/ 100/);
    expect(banner.className).toContain("text-red-600");

    renderModal([question({ marks: 100 })], 100);
    const matched = await screen.findAllByText(/Marks: 100 \/ 100/);
    expect(matched[matched.length - 1]!.className).toContain("text-green-700");
  });

  it("adding a question calls createPracticalQuestion and refreshes the list", async () => {
    vi.mocked(api.createPracticalQuestion).mockResolvedValue(question({ id: "q2", title: "New question" }));
    const user = userEvent.setup();
    renderModal([]);
    await screen.findByText("No questions yet.");

    await user.type(screen.getByPlaceholderText(/Build a signup form/i), "New question");
    await user.click(screen.getByRole("button", { name: "Add question" }));

    await waitFor(() => {
      expect(api.createPracticalQuestion).toHaveBeenCalledWith(
        "exam1",
        expect.objectContaining({ title: "New question" })
      );
    });
  });

  it("deleting a question asks for confirmation and calls deletePracticalQuestion", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.deletePracticalQuestion).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderModal([question()]);
    await screen.findByText("Build a signup form");

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(api.deletePracticalQuestion).toHaveBeenCalledWith("exam1", "q1");
    });
  });

  it("shows a locked banner when the server rejects a change because the exam already has an assignment", async () => {
    vi.mocked(api.createPracticalQuestion).mockRejectedValue(
      new Error("Cannot change questions: this exam already has at least one student assignment. Archive it and create a new exam instead.")
    );
    const user = userEvent.setup();
    renderModal([]);
    await screen.findByText("No questions yet.");

    await user.type(screen.getByPlaceholderText(/Build a signup form/i), "New question");
    await user.click(screen.getByRole("button", { name: "Add question" }));

    expect(await screen.findByText(/questions are locked/i)).toBeInTheDocument();
  });

  it("reorders a question up via the arrow button", async () => {
    vi.mocked(api.reorderPracticalQuestion).mockResolvedValue({ ok: true, moved: true });
    const user = userEvent.setup();
    renderModal([question({ id: "q1", title: "First" }), question({ id: "q2", title: "Second" })]);
    await screen.findByText("Second");

    const upButtons = screen.getAllByText("↑");
    await user.click(upButtons[1]!); // the second question's up arrow

    await waitFor(() => {
      expect(api.reorderPracticalQuestion).toHaveBeenCalledWith("exam1", "q2", "up");
    });
  });
});
