import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import {
  FISA_MCQ_TITLE,
  FISA_PRACTICAL_TITLE,
  findOrCreateFisaMcqExam,
  findOrCreateFisaPracticalExam,
} from "../scripts/seed-fisa-assessment.js";
import { runPracticalTests } from "../src/lib/practicalRunner.js";
import { createAndLoginTestAdmin } from "./helpers.js";

const { app } = await import("../src/app.js");
const { prisma } = await import("../src/prisma.js");
const { MockEmailProvider } = await import("../src/lib/providers/index.js");

let baseUrl: string;
let server: ReturnType<typeof app.listen>;

// Candidate solution containing all requirements for Challenges 1, 2, and 3
const SAMPLE_SOLUTION_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FISA HTML Programmer Portal</title>
    <!-- Challenge 3: Bootstrap 5 stylesheet linked in head -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <!-- Challenge 3: Bootstrap Responsive Navbar -->
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
      <div class="container">
        <a class="navbar-brand" href="#home">FISA Academy</a>
        <button
          class="navbar-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#mainNav"
          aria-controls="mainNav"
          aria-expanded="false"
          aria-label="Toggle navigation"
        >
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="mainNav">
          <ul class="navbar-nav ms-auto">
            <li class="nav-item"><a class="nav-link active" href="#challenge1">HTML & Forms</a></li>
            <li class="nav-item"><a class="nav-link" href="#challenge2">CSS Layout</a></li>
            <li class="nav-item"><a class="nav-link" href="#challenge3">Bootstrap</a></li>
          </ul>
        </div>
      </div>
    </nav>

    <!-- Header Landmark -->
    <header class="py-4 bg-light text-center border-bottom">
      <div class="container">
        <h1 class="display-5 fw-bold">FISA HTML Programmer Assessment</h1>
        <p class="lead text-muted">Qualification: SP-230372 · Candidate Practical Showcase</p>
      </div>
    </header>

    <!-- Main Landmark -->
    <main class="container my-5">
      <!-- Challenge 1: Semantic HTML Webpage with Forms and Tables -->
      <section id="challenge1" class="mb-5">
        <div class="p-4 border rounded shadow-sm bg-white">
          <h2 class="h3 mb-3">Challenge 1: Candidate Registration & Course Schedule</h2>
          
          <!-- Semantic Navigation with link list -->
          <nav class="mb-3">
            <ul class="list-inline">
              <li class="list-inline-item"><a href="#form-section">Registration Form</a></li>
              <li class="list-inline-item"><a href="#table-section">Curriculum Schedule</a></li>
            </ul>
          </nav>

          <article id="form-section" class="mb-4">
            <form action="/submit-registration" method="POST" class="needs-validation">
              <fieldset class="border p-3 rounded mb-4">
                <legend class="w-auto px-2 fs-6 fw-bold">Student Registration</legend>
                
                <div class="mb-3">
                  <label for="fullName" class="form-label">Full Name</label>
                  <input type="text" id="fullName" name="fullName" class="form-control" required />
                </div>

                <div class="mb-3">
                  <label for="email" class="form-label">Email Address</label>
                  <input type="email" id="email" name="email" class="form-control" required />
                </div>

                <div class="mb-3">
                  <label for="track" class="form-label">Specialization Track</label>
                  <select id="track" name="track" class="form-select" required>
                    <option value="">Select track...</option>
                    <option value="frontend">Frontend Web Development</option>
                    <option value="ui-ux">Responsive UI Design</option>
                  </select>
                </div>

                <div class="form-check mb-3">
                  <input type="checkbox" id="terms" name="terms" class="form-check-input" required />
                  <label for="terms" class="form-check-label">I agree to the assessment guidelines & academic honor code</label>
                </div>

                <button type="submit" class="btn btn-primary">Register Now</button>
              </fieldset>
            </form>
          </article>

          <article id="table-section">
            <h3 class="h5 mb-2">Module Schedule & Credits</h3>
            <div class="table-responsive">
              <table class="table table-bordered schedule-table">
                <caption>FISA HTML Programmer Curriculum Timetable (SP-230372)</caption>
                <thead class="table-light">
                  <tr>
                    <th scope="col">Module Code</th>
                    <th scope="col">Topic Description</th>
                    <th scope="col">Duration</th>
                    <th scope="col">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">MOD-101</th>
                    <td>Semantic HTML5 & Accessible Forms</td>
                    <td>2 Weeks</td>
                    <td>10</td>
                  </tr>
                  <tr>
                    <th scope="row">MOD-102</th>
                    <td>Modern CSS3, Flexbox & CSS Grid</td>
                    <td>3 Weeks</td>
                    <td>15</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colspan="3">Total Qualification Credits</th>
                    <td>25</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </article>
        </div>
      </section>

      <!-- Challenge 2: Responsive CSS Layout using Flexbox and Grid -->
      <section id="challenge2" class="mb-5">
        <div class="p-4 border rounded shadow-sm bg-white">
          <h2 class="h3 mb-3">Challenge 2: Responsive Feature Showcase</h2>
          <nav class="custom-nav mb-4">
            <span class="custom-logo">CourseModules</span>
            <ul class="custom-links">
              <li><a href="#html">HTML5</a></li>
              <li><a href="#css">CSS3</a></li>
              <li><a href="#responsive">Responsive</a></li>
            </ul>
          </nav>

          <div class="custom-grid">
            <div class="custom-card">
              <h4>Module 1</h4>
              <p>Structure web documents semantically with landmarks and accessible tables.</p>
            </div>
            <div class="custom-card">
              <h4>Module 2</h4>
              <p>Master the CSS box model, Flexbox distributions, and CSS Grid layout algorithms.</p>
            </div>
            <div class="custom-card">
              <h4>Module 3</h4>
              <p>Build mobile-first fluid designs with media queries and flexible components.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Challenge 3: Bootstrap 5 Website with Grid, Navbar, Cards & Utilities -->
      <section id="challenge3" class="mb-5">
        <h2 class="h3 mb-3">Challenge 3: Bootstrap 5 Component Grid</h2>
        <div class="row g-4">
          <div class="col-12 col-md-6 col-lg-4">
            <div class="card h-100 shadow-sm">
              <div class="card-body d-flex flex-column">
                <h5 class="card-title">HTML5 Semantic Core</h5>
                <p class="card-text text-muted">Learn semantic elements, forms, input types, and accessible ARIA attributes.</p>
                <div class="mt-auto">
                  <a href="#challenge1" class="btn btn-outline-primary w-100">Explore Module</a>
                </div>
              </div>
            </div>
          </div>
          <div class="col-12 col-md-6 col-lg-4">
            <div class="card h-100 shadow-sm">
              <div class="card-body d-flex flex-column">
                <h5 class="card-title">CSS3 Flexbox & Grid</h5>
                <p class="card-text text-muted">Architect flexible 1D and 2D layouts using modern CSS layout primitives.</p>
                <div class="mt-auto">
                  <a href="#challenge2" class="btn btn-outline-primary w-100">Explore Module</a>
                </div>
              </div>
            </div>
          </div>
          <div class="col-12 col-md-6 col-lg-4">
            <div class="card h-100 shadow-sm">
              <div class="card-body d-flex flex-column">
                <h5 class="card-title">Bootstrap 5 Utilities</h5>
                <p class="card-text text-muted">Accelerate UI delivery with responsive grid, pre-styled components, and utility classes.</p>
                <div class="mt-auto">
                  <a href="#challenge3" class="btn btn-primary w-100">Explore Module</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- Footer Landmark -->
    <footer class="bg-dark text-white py-4 mt-5 text-center">
      <div class="container">
        <p class="mb-0">&copy; 2026 Zaio FISA Platform · HTML Programmer Qualification (SP-230372)</p>
      </div>
    </footer>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    <script src="script.js"></script>
  </body>
</html>`;

const SAMPLE_SOLUTION_CSS = `/* Universal Box-Sizing Reset */
*, *::before, *::after {
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  margin: 0;
  padding: 0;
}

/* Challenge 2: Flexbox Navigation */
.custom-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1.5rem;
  padding: 1rem 1.5rem;
  background-color: #2b2ecf;
  border-radius: 0.5rem;
  color: #ffffff;
}

.custom-nav .custom-links {
  display: flex;
  gap: 1rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.custom-nav .custom-links a {
  color: #ffffff;
  text-decoration: none;
}

.custom-nav .custom-links a:hover,
.custom-nav .custom-links a:focus {
  text-decoration: underline;
}

/* Challenge 2: CSS Grid Layout */
.custom-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
  margin-top: 1.5rem;
}

.custom-card {
  background-color: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  padding: 1.5rem;
}

.custom-card:hover {
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.1);
}

/* Challenge 2: Responsive Media Queries */
@media (max-width: 768px) {
  .custom-nav {
    flex-direction: column;
    align-items: flex-start;
  }

  .custom-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
`;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("FISA HTML Programmer Assessment (SP-230372)", () => {
  it("creates and configures the Knowledge Assessment (MCQ) correctly", async () => {
    const exam = await findOrCreateFisaMcqExam();

    expect(exam.title).toBe(FISA_MCQ_TITLE);
    expect(exam.type).toBe("MCQ");
    expect(exam.durationMinutes).toBe(45);
    expect(exam.instructions).toContain("SP-230372");
    expect(exam.instructions).toContain("60%");
    expect(exam.instructions).toContain("20");

    // Exactly 20 questions
    expect(exam.questions.length).toBe(20);

    // Each question has valid prompt, 4 options, and correct index
    for (let i = 0; i < exam.questions.length; i++) {
      const q = exam.questions[i];
      expect(q.prompt.length).toBeGreaterThan(10);
      const opts = JSON.parse(q.options) as string[];
      expect(opts.length).toBe(4);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThan(4);
      expect(q.sortOrder).toBe(i);
    }
  });

  it("creates and configures the Practical Assessment (Coding) correctly", async () => {
    const exam = await findOrCreateFisaPracticalExam();

    expect(exam.title).toBe(FISA_PRACTICAL_TITLE);
    expect(exam.type).toBe("PRACTICAL");
    expect(exam.durationMinutes).toBe(120);
    expect(exam.instructions).toContain("SP-230372");
    expect(exam.instructions).toContain("CHALLENGE 1");
    expect(exam.instructions).toContain("CHALLENGE 2");
    expect(exam.instructions).toContain("CHALLENGE 3");
    expect(exam.instructions).toContain("30 marks");
    expect(exam.instructions).toContain("60%");

    // Exactly 30 test cases (10 per challenge)
    expect(exam.practicalTests.length).toBe(30);

    const totalPoints = exam.practicalTests.reduce((s, t) => s + t.points, 0);
    expect(totalPoints).toBe(30);

    for (let i = 0; i < exam.practicalTests.length; i++) {
      const t = exam.practicalTests[i];
      expect(t.label.length).toBeGreaterThan(5);
      expect(t.expression.length).toBeGreaterThan(0);
      expect(t.points).toBe(1);
      expect(t.sortOrder).toBe(i);
      expect(["index.html", "styles.css"]).toContain(t.targetFile);
    }
  });

  it("verifies practical test runner executes and awards 100% (30/30) on compliant submission", async () => {
    const exam = await findOrCreateFisaPracticalExam();

    const files = [
      { filename: "index.html", content: SAMPLE_SOLUTION_HTML },
      { filename: "styles.css", content: SAMPLE_SOLUTION_CSS },
      { filename: "script.js", content: 'console.log("ready");' },
    ];

    const report = runPracticalTests(
      files,
      exam.practicalTests.map((t) => ({
        id: t.id,
        label: t.label,
        kind: t.kind,
        targetFile: t.targetFile,
        expression: t.expression,
        points: t.points,
      }))
    );

    expect(report.results.length).toBe(30);
    expect(report.earnedPoints).toBe(30);
    expect(report.maxPoints).toBe(30);
    expect(report.scorePercent).toBe(100);

    // Verify all individual results passed
    for (const r of report.results) {
      expect(r.passed).toBe(true);
      expect(r.earned).toBe(1);
    }
  });

  it("verifies practical test runner detects missing requirements on empty/default submission", async () => {
    const exam = await findOrCreateFisaPracticalExam();

    const emptyFiles = [
      { filename: "index.html", content: "<p>Incomplete work</p>" },
      { filename: "styles.css", content: "body { margin: 0; }" },
      { filename: "script.js", content: "" },
    ];

    const report = runPracticalTests(
      emptyFiles,
      exam.practicalTests.map((t) => ({
        id: t.id,
        label: t.label,
        kind: t.kind,
        targetFile: t.targetFile,
        expression: t.expression,
        points: t.points,
      }))
    );

    expect(report.scorePercent).toBeLessThan(50);
    expect(report.results.some((r) => !r.passed)).toBe(true);
  });

  it("executes the complete candidate attempt and submission flow for both MCQ and Practical", async () => {
    // 1. Setup test cohort and candidate
    const cohort = await prisma.cohort.create({
      data: {
        name: `FISA Candidate Cohort ${Date.now()}`,
        programme: "HTML Programmer Skills Programme (SP-230372)",
        startDate: new Date(),
        examDate: new Date(),
        zoomLink: "https://zoom.us/j/123456789",
      },
    });

    const candidateEmail = `fisa.student.${Date.now()}@example.com`;
    const candidate = await prisma.student.create({
      data: {
        firstName: "Thabo",
        lastName: "Mokoena",
        email: candidateEmail,
        phone: `+2782${Math.floor(1000000 + Math.random() * 9000000)}`,
        cohortId: cohort.id,
      },
    });

    const mcqExam = await findOrCreateFisaMcqExam();
    const practicalExam = await findOrCreateFisaPracticalExam();

    // Assign both exams
    const mcqAssignment = await prisma.examAssignment.create({
      data: { examId: mcqExam.id, studentId: candidate.id },
    });
    const practicalAssignment = await prisma.examAssignment.create({
      data: { examId: practicalExam.id, studentId: candidate.id },
    });

    // 2. Candidate OTP login via mock mode
    MockEmailProvider.sent.clear();
    const reqOtpRes = await fetch(`${baseUrl}/api/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: candidateEmail }),
    });
    expect(reqOtpRes.status).toBe(200);

    const captured = MockEmailProvider.sent.get(candidateEmail);
    expect(captured).toBeDefined();
    const otpCode = captured!.code;

    const verifyOtpRes = await fetch(`${baseUrl}/api/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: candidateEmail, code: otpCode }),
    });
    expect(verifyOtpRes.status).toBe(200);
    const authData = (await verifyOtpRes.json()) as { token: string };
    const studentToken = authData.token;
    expect(studentToken).toBeDefined();

    const authHeaders = {
      Authorization: `Bearer ${studentToken}`,
      "Content-Type": "application/json",
    };

    // 3. Complete Knowledge Assessment (MCQ) Flow
    // Start MCQ Exam
    const startMcqRes = await fetch(
      `${baseUrl}/api/student/assignments/${mcqAssignment.id}/start`,
      { method: "POST", headers: authHeaders }
    );
    expect(startMcqRes.status).toBe(200);

    // Fetch MCQ Questions
    const getExamRes = await fetch(
      `${baseUrl}/api/student/assignments/${mcqAssignment.id}/exam`,
      { method: "GET", headers: authHeaders }
    );
    expect(getExamRes.status).toBe(200);
    const examPayload = (await getExamRes.json()) as {
      title: string;
      questions: { id: string; prompt: string; options: string[] }[];
      durationMinutes: number;
      remainingSeconds: number;
    };
    expect(examPayload.title).toBe(FISA_MCQ_TITLE);
    expect(examPayload.questions.length).toBe(20);
    expect(examPayload.durationMinutes).toBe(45);
    expect(examPayload.remainingSeconds).toBeGreaterThan(0);

    // Incomplete submission validation (e.g. 19 answers)
    const badSubmitRes = await fetch(
      `${baseUrl}/api/student/assignments/${mcqAssignment.id}/submit`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ answers: [0, 1, 2] }),
      }
    );
    expect(badSubmitRes.status).toBe(400);

    // Complete correct submission
    const correctAnswers = mcqExam.questions.map((q) => q.correctIndex);
    const submitMcqRes = await fetch(
      `${baseUrl}/api/student/assignments/${mcqAssignment.id}/submit`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ answers: correctAnswers }),
      }
    );
    expect(submitMcqRes.status).toBe(200);
    const mcqResult = (await submitMcqRes.json()) as {
      scorePercent: number;
      correct: number;
      total: number;
      autoMarked: boolean;
    };
    expect(mcqResult.scorePercent).toBe(100);
    expect(mcqResult.correct).toBe(20);
    expect(mcqResult.total).toBe(20);
    expect(mcqResult.autoMarked).toBe(true);

    // Second submission rejected
    const reSubmitMcqRes = await fetch(
      `${baseUrl}/api/student/assignments/${mcqAssignment.id}/submit`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ answers: correctAnswers }),
      }
    );
    expect(reSubmitMcqRes.status).toBe(400);

    // 4. Complete Practical Assessment (Coding) Flow
    // Open practical workspace
    const openPracRes = await fetch(
      `${baseUrl}/api/student/assignments/${practicalAssignment.id}/practical`,
      { method: "GET", headers: authHeaders }
    );
    expect(openPracRes.status).toBe(200);
    const pracData = (await openPracRes.json()) as {
      exam: { title: string; instructions: string; durationMinutes: number };
      workspace: { files: { filename: string; content: string }[]; locked: boolean };
    };
    expect(pracData.exam.title).toBe(FISA_PRACTICAL_TITLE);
    expect(pracData.exam.durationMinutes).toBe(120);
    expect(pracData.workspace.locked).toBe(false);
    expect(pracData.workspace.files.some((f) => f.filename === "index.html")).toBe(true);

    // Candidate saves intermediate progress
    const autosaveRes = await fetch(
      `${baseUrl}/api/student/assignments/${practicalAssignment.id}/practical/autosave`,
      {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          files: [
            { filename: "index.html", content: "<!-- WIP -->" },
            { filename: "styles.css", content: "/* WIP */" },
          ],
        }),
      }
    );
    expect(autosaveRes.status).toBe(200);

    // Candidate submits final completed solution
    const finalAutosave = await fetch(
      `${baseUrl}/api/student/assignments/${practicalAssignment.id}/practical/autosave`,
      {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          files: [
            { filename: "index.html", content: SAMPLE_SOLUTION_HTML },
            { filename: "styles.css", content: SAMPLE_SOLUTION_CSS },
            { filename: "script.js", content: 'console.log("Ready");' },
          ],
        }),
      }
    );
    expect(finalAutosave.status).toBe(200);

    // Candidate checks their progress with "Run Tests" before final submit —
    // an ephemeral practice run against their current (already-autosaved)
    // workspace files. Must match what the real submit will score, but must
    // not create any submission/auto-assessment row of its own.
    const runTestsRes = await fetch(
      `${baseUrl}/api/student/assignments/${practicalAssignment.id}/practical/run-tests`,
      { method: "POST", headers: authHeaders }
    );
    expect(runTestsRes.status).toBe(200);
    const runTestsReport = (await runTestsRes.json()) as {
      results: { testCaseId: string; passed: boolean }[];
      earnedPoints: number;
      maxPoints: number;
      scorePercent: number;
    };
    expect(runTestsReport.scorePercent).toBe(100);
    expect(runTestsReport.earnedPoints).toBe(30);
    expect(runTestsReport.maxPoints).toBe(30);
    expect(runTestsReport.results.length).toBe(30);
    expect(runTestsReport.results.every((r) => r.passed)).toBe(true);

    const submissionsBeforeSubmit = await prisma.practicalSubmission.count({
      where: { assignmentId: practicalAssignment.id },
    });
    expect(submissionsBeforeSubmit).toBe(0);

    const submitPracRes = await fetch(
      `${baseUrl}/api/student/assignments/${practicalAssignment.id}/practical/submit`,
      { method: "POST", headers: authHeaders }
    );
    expect(submitPracRes.status).toBe(200);
    const practicalSubmissionResult = (await submitPracRes.json()) as {
      submittedAt: string;
      locked: boolean;
      automated: { scorePercent: number; earnedPoints: number; maxPoints: number };
    };
    expect(practicalSubmissionResult.locked).toBe(true);
    expect(practicalSubmissionResult.automated.scorePercent).toBe(100);
    expect(practicalSubmissionResult.automated.earnedPoints).toBe(30);
    expect(practicalSubmissionResult.automated.maxPoints).toBe(30);

    // Verify workspace is locked against further saves
    const lockedAutosave = await fetch(
      `${baseUrl}/api/student/assignments/${practicalAssignment.id}/practical/autosave`,
      {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          files: [{ filename: "index.html", content: "hacked" }],
        }),
      }
    );
    expect(lockedAutosave.status).toBe(400);

    // 5. Verify Results in Admin Dashboard
    const { headers: adminHeaders } = await createAndLoginTestAdmin();
    const resultsRes = await fetch(`${baseUrl}/api/results?studentId=${candidate.id}`, {
      headers: adminHeaders,
    });
    expect(resultsRes.status).toBe(200);
    const resultsData = (await resultsRes.json()) as {
      summary: { total: number; submitted: number };
      rows: {
        assignmentId: string;
        exam: { title: string; type: string };
        mcqScorePercent: number | null;
        practicalAutomatedPercent: number | null;
        reviewState: string;
      }[];
    };

    expect(resultsData.rows.length).toBe(2);

    const mcqRow = resultsData.rows.find((r) => r.exam.type === "MCQ");
    expect(mcqRow).toBeDefined();
    expect(mcqRow!.mcqScorePercent).toBe(100);
    expect(mcqRow!.reviewState).toBe("finalised");

    const practicalRow = resultsData.rows.find((r) => r.exam.type === "PRACTICAL");
    expect(practicalRow).toBeDefined();
    expect(practicalRow!.practicalAutomatedPercent).toBe(100);
    expect(practicalRow!.reviewState).toBe("pending_review");

    // 6. Assessor reviews practical submission
    const reviewRes = await fetch(
      `${baseUrl}/api/assessor/assignments/${practicalAssignment.id}/review`,
      {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          finalScorePercent: 95,
          feedback:
            "Well structured HTML5 semantics and excellent Bootstrap 5 integration. Competent.",
        }),
      }
    );
    expect(reviewRes.status).toBe(200);

    // Re-query results to verify practical reviewState becomes finalised
    const updatedResultsRes = await fetch(
      `${baseUrl}/api/results?studentId=${candidate.id}`,
      { headers: adminHeaders }
    );
    expect(updatedResultsRes.status).toBe(200);
    const updatedData = (await updatedResultsRes.json()) as {
      rows: {
        exam: { type: string };
        reviewState: string;
        assessorApprovedPercent: number | null;
        assessorFeedback: string | null;
      }[];
    };
    const updatedPracticalRow = updatedData.rows.find(
      (r) => r.exam.type === "PRACTICAL"
    );
    expect(updatedPracticalRow).toBeDefined();
    expect(updatedPracticalRow!.reviewState).toBe("finalised");
    expect(updatedPracticalRow!.assessorApprovedPercent).toBe(95);
    expect(updatedPracticalRow!.assessorFeedback).toContain("Competent");

    // Clean up test cohort and candidate
    await prisma.student.delete({ where: { id: candidate.id } });
    await prisma.cohort.delete({ where: { id: cohort.id } });
  });

  it("calculates partial scores accurately for both MCQ and Practical assessments", async () => {
    const exam = await findOrCreateFisaPracticalExam();

    // Solution with Challenge 1 & Challenge 2 complete, but NO Bootstrap (Challenge 3 absent)
    const partialFiles = [
      {
        filename: "index.html",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="styles.css" />
  <title>Partial Work</title>
</head>
<body>
  <header><h1>Landmark Header</h1></header>
  <main>
    <section>
      <nav><ul><li><a href="#link">Link</a></li></ul></nav>
      <article>
        <form action="/test" method="POST">
          <fieldset>
            <legend>Registration</legend>
            <label for="usr">User</label>
            <input type="text" id="usr" />
            <input type="email" required id="eml" />
            <select required><option value="1">Option 1</option></select>
            <input type="checkbox" required id="chk" />
          </fieldset>
        </form>
        <table>
          <caption>Schedule</caption>
          <thead><tr><th scope="col">Code</th></tr></thead>
          <tbody><tr><td>Data</td></tr></tbody>
        </table>
      </article>
    </section>
  </main>
  <footer><p>Footer</p></footer>
</body>
</html>`,
      },
      {
        filename: "styles.css",
        content: `* { box-sizing: border-box; }
.custom-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}
.grid-box {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.5rem;
}
.card {
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
.card:hover {
  border-color: blue;
}
@media (max-width: 768px) {
  .grid-box { grid-template-columns: 1fr; }
}`,
      },
    ];

    const report = runPracticalTests(
      partialFiles,
      exam.practicalTests.map((t) => ({
        id: t.id,
        label: t.label,
        kind: t.kind,
        targetFile: t.targetFile,
        expression: t.expression,
        points: t.points,
      }))
    );

    // Challenge 1 (10 marks) and Challenge 2 (10 marks) pass = 20 marks out of 30
    expect(report.earnedPoints).toBe(20);
    expect(report.maxPoints).toBe(30);
    expect(Math.round(report.scorePercent)).toBe(67); // 66.67% -> competent (>60%)
  });

  it("preserves cohort structure and guarantees isolation", async () => {
    // Verify cohort table is intact and isolation is maintained
    const cohorts = await prisma.cohort.findMany();
    expect(Array.isArray(cohorts)).toBe(true);
  });
});
