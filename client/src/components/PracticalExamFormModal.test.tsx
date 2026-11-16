import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PracticalExamFormModal } from "./PracticalExamFormModal";
import * as api from "../api";

vi.mock("../api", () => ({
  createPracticalExam: vi.fn(),
  createPracticalQuestion: vi.fn(),
  uploadPracticalQuestionReferenceAsset: vi.fn(),
  deleteExam: vi.fn(),
}));

function renderModal() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<PracticalExamFormModal cohorts={[]} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
}

async function fillExamBasics(user: ReturnType<typeof userEvent.setup>, title = "New practical exam") {
  await user.type(screen.getByLabelText("Title"), title);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PracticalExamFormModal — backward compatibility (no questions)", () => {
  it("creates a bare exam with zero questions, exactly as before", async () => {
    vi.mocked(api.createPracticalExam).mockResolvedValue({ id: "exam-1" } as never);
    const user = userEvent.setup();
    const { onSaved } = renderModal();

    await fillExamBasics(user);
    await user.click(screen.getByRole("button", { name: "Create exam" }));

    await waitFor(() => {
      expect(api.createPracticalExam).toHaveBeenCalledTimes(1);
    });
    expect(api.createPracticalQuestion).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(null);
  });

  it("rejects submission with no title", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderModal();
    await user.click(screen.getByRole("button", { name: "Create exam" }));
    expect(api.createPracticalExam).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("PracticalExamFormModal — inline multi-question creation", () => {
  it("creates the exam then each question in order, and reports success", async () => {
    vi.mocked(api.createPracticalExam).mockResolvedValue({ id: "exam-1" } as never);
    vi.mocked(api.createPracticalQuestion)
      .mockResolvedValueOnce({ id: "q1" } as never)
      .mockResolvedValueOnce({ id: "q2" } as never);
    const user = userEvent.setup();
    const { onSaved } = renderModal();

    await fillExamBasics(user);
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.click(screen.getByRole("button", { name: "Add question" }));

    const titleInputs = screen.getAllByPlaceholderText(/title \(e\.g\. Build a signup form\)/i);
    await user.type(titleInputs[0]!, "Build a signup form");
    await user.type(titleInputs[1]!, "Style the page");

    const marksInputs = screen.getAllByLabelText("Marks");
    await user.clear(marksInputs[0]!);
    await user.type(marksInputs[0]!, "60");
    await user.clear(marksInputs[1]!);
    await user.type(marksInputs[1]!, "40");

    await user.click(screen.getByRole("button", { name: "Create exam" }));

    await waitFor(() => {
      expect(api.createPracticalQuestion).toHaveBeenCalledTimes(2);
    });
    expect(api.createPracticalQuestion).toHaveBeenNthCalledWith(
      1,
      "exam-1",
      expect.objectContaining({ title: "Build a signup form", marks: 60 })
    );
    expect(api.createPracticalQuestion).toHaveBeenNthCalledWith(
      2,
      "exam-1",
      expect.objectContaining({ title: "Style the page", marks: 40 })
    );
    expect(onSaved).toHaveBeenCalledWith(null);
  });

  it("blocks submission when a question has no title", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderModal();
    await fillExamBasics(user);
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.click(screen.getByRole("button", { name: "Create exam" }));

    expect(await screen.findByText(/every question needs a title/i)).toBeInTheDocument();
    expect(api.createPracticalExam).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("blocks submission when question marks don't sum to total marks, and auto-distribute fixes it", async () => {
    vi.mocked(api.createPracticalExam).mockResolvedValue({ id: "exam-1" } as never);
    vi.mocked(api.createPracticalQuestion).mockResolvedValue({ id: "q1" } as never);
    const user = userEvent.setup();
    renderModal();
    await fillExamBasics(user);
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.type(screen.getByPlaceholderText(/title \(e\.g\. Build a signup form\)/i), "Q1");

    await user.click(screen.getByRole("button", { name: "Create exam" }));
    expect(await screen.findByText(/marks sum to 0, but total marks is 100/i)).toBeInTheDocument();
    expect(api.createPracticalExam).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Auto-distribute" }));
    await user.click(screen.getByRole("button", { name: "Create exam" }));

    await waitFor(() => {
      expect(api.createPracticalExam).toHaveBeenCalledTimes(1);
    });
  });

  it("rolls back (deletes the exam) and keeps the modal open when a question fails to save", async () => {
    vi.mocked(api.createPracticalExam).mockResolvedValue({ id: "exam-1" } as never);
    vi.mocked(api.createPracticalQuestion).mockRejectedValue(new Error("server exploded"));
    vi.mocked(api.deleteExam).mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { onSaved } = renderModal();

    await fillExamBasics(user);
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.type(screen.getByPlaceholderText(/title \(e\.g\. Build a signup form\)/i), "Q1");
    const marksInput = screen.getByLabelText("Marks");
    await user.clear(marksInput);
    await user.type(marksInput, "100");

    await user.click(screen.getByRole("button", { name: "Create exam" }));

    await waitFor(() => {
      expect(api.deleteExam).toHaveBeenCalledWith("exam-1");
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(await screen.findByText(/nothing was kept/i)).toBeInTheDocument();
  });

  it("warns (without rolling back) when a question is saved but its reference file fails to upload", async () => {
    vi.mocked(api.createPracticalExam).mockResolvedValue({ id: "exam-1" } as never);
    vi.mocked(api.createPracticalQuestion).mockResolvedValue({ id: "q1" } as never);
    vi.mocked(api.uploadPracticalQuestionReferenceAsset).mockRejectedValue(new Error("file too large"));
    const user = userEvent.setup();
    const { onSaved } = renderModal();

    await fillExamBasics(user);
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.type(screen.getByPlaceholderText(/title \(e\.g\. Build a signup form\)/i), "Q1");
    const marksInput = screen.getByLabelText("Marks");
    await user.clear(marksInput);
    await user.type(marksInput, "100");

    const file = new File(["fake-pdf-bytes"], "brief.pdf", { type: "application/pdf" });
    const fileInput = screen.getByLabelText(/\+ add file/i, { selector: "input" });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: "Create exam" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    const warning = onSaved.mock.calls[0]![0] as string;
    expect(warning).toContain("brief.pdf");
    expect(api.deleteExam).not.toHaveBeenCalled();
  });
});
