import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PracticalExamPage } from "./PracticalExamPage";
import * as api from "../../api";

vi.mock("../../api", () => ({
  autosavePractical: vi.fn(),
  createPracticalFile: vi.fn(),
  deletePracticalFile: vi.fn(),
  fetchPracticalWorkspace: vi.fn(),
  renamePracticalFile: vi.fn(),
  runPracticalTests: vi.fn(),
  submitPracticalExam: vi.fn(),
}));

vi.mock("../../student/proctoringHelpers", () => ({
  bindProctoringExamMonitors: vi.fn(() => () => {}),
  logProctoringEvent: vi.fn(),
  uploadAndEndProctoring: vi.fn(),
}));

const WORKSPACE = {
  id: "ws1",
  assignmentId: "a1",
  studentId: "s1",
  activeFile: "index.html",
  startedAt: new Date().toISOString(),
  lockedAt: null,
  lastSavedAt: new Date().toISOString(),
  locked: false,
  files: [{ id: "f1", filename: "index.html", content: "<h1>Hi</h1>", updatedAt: new Date().toISOString() }],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/student/practical/a1"]}>
      <Routes>
        <Route path="/student/practical/:assignmentId" element={<PracticalExamPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // The autosave debounce timer (1200ms, real — not faked here) can still
  // fire after a test's assertions are done; give it somewhere safe to land.
  vi.mocked(api.autosavePractical).mockResolvedValue({ savedAt: new Date().toISOString(), workspace: WORKSPACE });
});

describe("PracticalExamPage — question brief rendering", () => {
  it("renders question cards (title, scenario, marks, requirements) when the exam has questions", async () => {
    vi.mocked(api.fetchPracticalWorkspace).mockResolvedValue({
      exam: {
        title: "FISA Practical",
        instructions: "Flat instructions string — must not be duplicated in the page header once questions exist.",
        durationMinutes: 60,
        questions: [
          {
            id: "q1",
            title: "Build a signup form",
            scenario: "A client needs a signup form",
            instructions: "Create index.html with a form",
            requirements: ["Has a name field", "Has an email field"],
            marks: 50,
            difficulty: "MEDIUM",
            sortOrder: 0,
          },
        ],
      },
      workspace: WORKSPACE,
    });

    const user = userEvent.setup();
    renderPage();

    // The page header shows only the exam title — the flat instructions
    // string must not also render there, duplicating the Brief & Rubric
    // panel's full question content.
    await screen.findByText("FISA Practical");
    expect(
      screen.queryByText("Flat instructions string — must not be duplicated in the page header once questions exist.")
    ).not.toBeInTheDocument();

    const briefButton = await screen.findByRole("button", { name: /View instructions and marking rubric/i });
    await user.click(briefButton);

    expect(await screen.findByRole("heading", { name: "Build a signup form" })).toBeInTheDocument();
    expect(screen.getByText("A client needs a signup form")).toBeInTheDocument();
    expect(screen.getByText("Has a name field")).toBeInTheDocument();
    expect(screen.getAllByText(/50 marks/).length).toBeGreaterThan(0);
  });

  it("falls back to the flat instructions string for a legacy exam with no questions", async () => {
    vi.mocked(api.fetchPracticalWorkspace).mockResolvedValue({
      exam: {
        title: "Legacy FISA Practical",
        instructions: "Build an index.html page with a header and footer.",
        durationMinutes: 60,
        questions: [],
      },
      workspace: WORKSPACE,
    });

    const user = userEvent.setup();
    renderPage();

    const briefButton = await screen.findByRole("button", { name: /View instructions and marking rubric/i });
    await user.click(briefButton);

    expect(
      (await screen.findAllByText("Build an index.html page with a header and footer.")).length
    ).toBeGreaterThan(0);
  });
});
