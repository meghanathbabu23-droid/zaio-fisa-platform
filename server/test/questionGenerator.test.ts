import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import { AdminRole, ExamType, PracticalTestKind } from "@prisma/client";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createAndLoginTestAdmin, createTestAdmin, createTestStudent, type AdminAuthHeaders } from "./helpers.js";
import { OtpChannel, requestOtp, verifyOtp } from "../src/lib/otp.js";
import { MockEmailProvider } from "../src/lib/providers/index.js";
import { aiConfig } from "../src/lib/aiConfig.js";
import type {
  AiClient,
  CodingGenerationParams,
  GeneratedCodingQuestion,
  GeneratedMcq,
  McqGenerationParams,
} from "../src/lib/aiClient.js";
import { generateExam, validateGenerationConfig, type GenerationConfig } from "../src/lib/questionGenerator.js";
import { tryAcquireGenerationLock, releaseGenerationLock, resetGenerationLockStateForTests } from "../src/lib/generationLock.js";
import { setAiClientOverrideForTests } from "../src/lib/aiClient.js";

let baseUrl: string;
let server: ReturnType<typeof app.listen>;
let superHeaders: AdminAuthHeaders;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  superHeaders = (await createAndLoginTestAdmin(AdminRole.SUPER_ADMIN)).headers;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  resetGenerationLockStateForTests();
  setAiClientOverrideForTests(undefined);
});

async function loginAsStudent(email: string): Promise<string> {
  await requestOtp({ channel: OtpChannel.EMAIL, value: email });
  const code = MockEmailProvider.sent.get(email)!.code;
  const result = await verifyOtp({ channel: OtpChannel.EMAIL, value: email, code });
  if (!result.ok) throw new Error("login failed");
  return result.token;
}

/**
 * Deterministic, fully injectable fake — never makes a real network call,
 * never requires an API key. Each test supplies a queue of outputs and an
 * embedding function so similarity behavior is fully controllable.
 */
class FakeAiClient implements AiClient {
  mcqQueue: GeneratedMcq[] = [];
  codingQueue: GeneratedCodingQuestion[] = [];
  embeddings: number[][] = [];
  avoidSummariesSeen: string[][] = [];
  callCount = 0;
  throwOnCall?: number;

  async generateMcq(params: McqGenerationParams): Promise<GeneratedMcq> {
    this.callCount++;
    this.avoidSummariesSeen.push(params.avoidSummaries);
    if (this.throwOnCall === this.callCount) throw new Error("simulated provider failure");
    const next = this.mcqQueue.shift();
    if (!next) throw new Error("FakeAiClient MCQ queue exhausted");
    return next;
  }

  async generateCodingQuestion(params: CodingGenerationParams): Promise<GeneratedCodingQuestion> {
    this.callCount++;
    this.avoidSummariesSeen.push(params.avoidSummaries);
    if (this.throwOnCall === this.callCount) throw new Error("simulated provider failure");
    const next = this.codingQueue.shift();
    if (!next) throw new Error("FakeAiClient coding queue exhausted");
    return next;
  }

  async embed(_text: string): Promise<number[]> {
    const next = this.embeddings.shift();
    if (!next) throw new Error("FakeAiClient embedding queue exhausted");
    return next;
  }
}

// GeneratedQuestionEmbedding rows persist in the shared test DB across
// test cases (no reset between them, matching this project's existing
// integration-test convention) — each test must use its own unique topic
// name so its similarity-check bucket never picks up another test's rows.
let topicCounter = 0;
function uniqueTopic(base: string): string {
  topicCounter += 1;
  return `${base}-${Date.now()}-${topicCounter}`;
}

function mcq(prompt: string, summary: string): GeneratedMcq {
  return { prompt, options: ["A", "B", "C", "D"], correctIndex: 0, summary };
}

const testAdminId = async () => (await createTestAdmin(AdminRole.SUPER_ADMIN)).id;

describe("validateGenerationConfig", () => {
  it("rejects a difficulty split that doesn't sum to 100", () => {
    const problems = validateGenerationConfig({
      type: ExamType.MCQ,
      title: "x",
      topics: ["HTML"],
      count: 2,
      difficulty: { EASY: 50, MEDIUM: 20, HARD: 10 },
      totalMarks: 10,
      durationMinutes: 30,
      cohortId: null,
    });
    expect(problems.some((p) => p.includes("sum to 100"))).toBe(true);
  });

  it("accepts a well-formed config", () => {
    expect(
      validateGenerationConfig({
        type: ExamType.MCQ,
        title: "x",
        topics: ["HTML"],
        count: 2,
        difficulty: { EASY: 50, MEDIUM: 50, HARD: 0 },
        totalMarks: 10,
        durationMinutes: 30,
        cohortId: null,
      })
    ).toEqual([]);
  });
});

describe("generationLock — concurrency protection", () => {
  it("rejects a second acquisition for the same admin while one is held, and allows it after release", () => {
    expect(tryAcquireGenerationLock("admin-x")).toBe(true);
    expect(tryAcquireGenerationLock("admin-x")).toBe(false);
    releaseGenerationLock("admin-x");
    expect(tryAcquireGenerationLock("admin-x")).toBe(true);
    releaseGenerationLock("admin-x");
  });

  it("locks are independent per admin", () => {
    expect(tryAcquireGenerationLock("admin-a")).toBe(true);
    expect(tryAcquireGenerationLock("admin-b")).toBe(true);
    releaseGenerationLock("admin-a");
    releaseGenerationLock("admin-b");
  });
});

describe("POST /api/exams/generate — route-level validation (no AI calls reached)", () => {
  it("returns 503 when AI generation is not configured (no API keys in this environment)", async () => {
    expect(aiConfig.isConfigured).toBe(false);
    const res = await fetch(`${baseUrl}/api/exams/generate`, {
      method: "POST",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "MCQ",
        title: "x",
        topics: ["HTML"],
        count: 1,
        difficulty: { EASY: 100, MEDIUM: 0, HARD: 0 },
        totalMarks: 10,
        durationMinutes: 30,
      }),
    });
    expect(res.status).toBe(503);
  });

  it("returns 400 for an invalid config before ever reaching AI/503 checks", async () => {
    const res = await fetch(`${baseUrl}/api/exams/generate`, {
      method: "POST",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "MCQ", title: "", topics: [], count: 0 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("generateExam — MCQ pipeline (injected FakeAiClient, zero network calls)", () => {
  it("produces distinct, marks-correct questions across consecutive slots and persists generation history", async () => {
    const adminId = await testAdminId();
    const fake = new FakeAiClient();
    fake.mcqQueue = [mcq("What is semantic HTML?", "semantic HTML basics"), mcq("What is a CSS selector?", "CSS selector basics")];
    fake.embeddings = [
      [1, 0],
      [0, 1],
    ];

    const topicHtml = uniqueTopic("HTML");
    const topicCss = uniqueTopic("CSS");
    const config: GenerationConfig = {
      type: ExamType.MCQ,
      title: `Generated MCQ ${Date.now()}`,
      topics: [topicHtml, topicCss],
      count: 2,
      difficulty: { EASY: 100, MEDIUM: 0, HARD: 0 },
      totalMarks: 100,
      durationMinutes: 45,
      cohortId: null,
    };

    const outcome = await generateExam(config, adminId, fake);
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") throw new Error("unreachable");

    const exam = await prisma.exam.findUnique({ where: { id: outcome.examId }, include: { questions: true } });
    expect(exam!.totalMarks).toBe(100);
    expect(exam!.questions.length).toBe(2);
    expect(exam!.questions.reduce((s, q) => s + q.marks, 0)).toBe(100);
    // Topic coverage — both configured topics used, round-robin.
    const embeddingRows = await prisma.generatedQuestionEmbedding.findMany({ where: { examId: outcome.examId } });
    expect(new Set(embeddingRows.map((r) => r.topic))).toEqual(new Set([topicHtml, topicCss]));
    expect(new Set(embeddingRows.map((r) => r.contentHash)).size).toBe(2); // distinct

    const job = await prisma.examGenerationJob.findUnique({ where: { id: outcome.jobId } });
    expect(job!.status).toBe("COMPLETED");
    expect(job!.resultExamId).toBe(outcome.examId);
    expect(job!.requestedByAdminId).toBe(adminId);

    const auditRow = await prisma.adminAuditLog.findFirst({ where: { action: "EXAM_AI_GENERATED", targetId: outcome.examId } });
    expect(auditRow).not.toBeNull();
  });

  it("rejects an exact-duplicate generation and regenerates a distinct replacement", async () => {
    const adminId = await testAdminId();
    const fake = new FakeAiClient();
    // Slot 1 succeeds immediately; slot 2's first attempt is an exact
    // duplicate of slot 1 (same text -> same hash), second attempt differs.
    fake.mcqQueue = [
      mcq("Duplicate question text", "dup scenario"),
      mcq("Duplicate question text", "dup scenario"),
      mcq("A genuinely different question", "different scenario"),
    ];
    fake.embeddings = [[1, 0], [1, 0], [0, 1]];

    const config: GenerationConfig = {
      type: ExamType.MCQ,
      title: `Dup-reject MCQ ${Date.now()}`,
      topics: [uniqueTopic("HTML")],
      count: 2,
      difficulty: { EASY: 100, MEDIUM: 0, HARD: 0 },
      totalMarks: 10,
      durationMinutes: 30,
      cohortId: null,
    };

    const outcome = await generateExam(config, adminId, fake);
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") throw new Error("unreachable");
    const job = await prisma.examGenerationJob.findUnique({ where: { id: outcome.jobId } });
    const stats = JSON.parse(job!.duplicateStatsJson!) as { attempts: number; accepted: boolean }[];
    expect(stats.some((s) => s.attempts > 1)).toBe(true);
  });

  it("rejects a near-duplicate above the similarity threshold (not just an exact hash match)", async () => {
    const adminId = await testAdminId();
    const fake = new FakeAiClient();
    fake.mcqQueue = [
      mcq("First unique question", "scenario A"),
      mcq("Second DIFFERENT text but same meaning", "scenario A rephrased"),
      mcq("Third, genuinely distinct question", "scenario B"),
    ];
    // Slot 2's first attempt embeds very close to slot 1's (cosine ~0.995,
    // above the default 0.88 threshold) despite different wording — this
    // is exactly the "simple word substitution" case the spec calls out.
    fake.embeddings = [[1, 0], [0.995, 0.0999], [0, 1]];

    const config: GenerationConfig = {
      type: ExamType.MCQ,
      title: `Near-dup MCQ ${Date.now()}`,
      topics: [uniqueTopic("HTML")],
      count: 2,
      difficulty: { EASY: 100, MEDIUM: 0, HARD: 0 },
      totalMarks: 10,
      durationMinutes: 30,
      cohortId: null,
    };

    const outcome = await generateExam(config, adminId, fake);
    expect(outcome.status).toBe("COMPLETED");
  });

  it("retries, rather than crashing or persisting bad data, when the AI returns a malformed MCQ (invalid-response scenario)", async () => {
    const adminId = await testAdminId();
    const fake = new FakeAiClient();
    // First attempt: options has only 3 entries and correctIndex is out of
    // range — a response that previously would have been blindly cast and
    // used as-is. Second attempt: well-formed.
    const malformed = { prompt: "Broken question", options: ["A", "B", "C"], correctIndex: 9, summary: "broken" };
    fake.mcqQueue = [malformed as unknown as GeneratedMcq, mcq("A well-formed question", "fixed scenario")];
    fake.embeddings = [[0, 1]]; // only consumed for the accepted (second) attempt

    const config: GenerationConfig = {
      type: ExamType.MCQ,
      title: `Invalid-response MCQ ${Date.now()}`,
      topics: [uniqueTopic("HTML")],
      count: 1,
      difficulty: { EASY: 100, MEDIUM: 0, HARD: 0 },
      totalMarks: 10,
      durationMinutes: 30,
      cohortId: null,
    };

    const outcome = await generateExam(config, adminId, fake);
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") throw new Error("unreachable");
    const exam = await prisma.exam.findUnique({ where: { id: outcome.examId }, include: { questions: true } });
    expect(exam!.questions).toHaveLength(1);
    expect(exam!.questions[0].prompt).toBe("A well-formed question");
    expect(exam!.questions[0].correctIndex).toBe(0); // never the malformed attempt's out-of-range 9
  });

  it("reports the slot unresolved (never crashes) when the AI returns malformed data on every attempt", async () => {
    const adminId = await testAdminId();
    const fake = new FakeAiClient();
    const malformed = { prompt: "", options: ["A"], correctIndex: -1, summary: "" };
    // aiConfig.maxRegenAttempts defaults to 3 — queue exactly that many
    // malformed responses, none well-formed.
    fake.mcqQueue = [
      malformed as unknown as GeneratedMcq,
      malformed as unknown as GeneratedMcq,
      malformed as unknown as GeneratedMcq,
    ];

    const config: GenerationConfig = {
      type: ExamType.MCQ,
      title: `Always-invalid MCQ ${Date.now()}`,
      topics: [uniqueTopic("HTML")],
      count: 1,
      difficulty: { EASY: 100, MEDIUM: 0, HARD: 0 },
      totalMarks: 10,
      durationMinutes: 30,
      cohortId: null,
    };

    const outcome = await generateExam(config, adminId, fake);
    expect(outcome.status).toBe("INSUFFICIENT_UNIQUENESS");
    if (outcome.status !== "INSUFFICIENT_UNIQUENESS") throw new Error("unreachable");
    expect(outcome.unresolvedSlots).toHaveLength(1);
    // Nothing was embedded or persisted as a real question/embedding row —
    // a malformed response never reaches the similarity check at all.
    const exams = await prisma.exam.findMany({ where: { title: config.title } });
    expect(exams).toHaveLength(0);
  });

  it("reports INSUFFICIENT_UNIQUENESS and saves nothing when a slot can't be resolved within the attempt cap", async () => {
    const adminId = await testAdminId();
    const fake = new FakeAiClient();
    const attempts = aiConfig.maxRegenAttempts;
    // Slot 1 succeeds; slot 2 is near-duplicate on every single attempt.
    fake.mcqQueue = [mcq("Baseline question", "baseline")];
    fake.embeddings = [[1, 0]];
    for (let i = 0; i < attempts; i++) {
      fake.mcqQueue.push(mcq(`Near dup attempt ${i}`, `near dup ${i}`));
      fake.embeddings.push([0.99, 0.141]);
    }

    const config: GenerationConfig = {
      type: ExamType.MCQ,
      title: `Insufficient uniqueness ${Date.now()}`,
      topics: [uniqueTopic("HTML")],
      count: 2,
      difficulty: { EASY: 100, MEDIUM: 0, HARD: 0 },
      totalMarks: 10,
      durationMinutes: 30,
      cohortId: null,
    };

    const outcome = await generateExam(config, adminId, fake);
    expect(outcome.status).toBe("INSUFFICIENT_UNIQUENESS");
    if (outcome.status !== "INSUFFICIENT_UNIQUENESS") throw new Error("unreachable");
    expect(outcome.unresolvedSlots.length).toBe(1);

    const job = await prisma.examGenerationJob.findUnique({ where: { id: outcome.jobId } });
    expect(job!.status).toBe("INSUFFICIENT_UNIQUENESS");
    expect(job!.resultExamId).toBeNull();
  });

  it("fails cleanly on a mid-batch provider error — no partial exam persisted, error message is generic", async () => {
    const adminId = await testAdminId();
    const fake = new FakeAiClient();
    fake.mcqQueue = [mcq("First question succeeds", "ok")];
    fake.embeddings = [[1, 0]];
    fake.throwOnCall = 2; // fails on the second generateMcq call

    const config: GenerationConfig = {
      type: ExamType.MCQ,
      title: `Mid-batch failure ${Date.now()}`,
      topics: [uniqueTopic("HTML")],
      count: 2,
      difficulty: { EASY: 100, MEDIUM: 0, HARD: 0 },
      totalMarks: 10,
      durationMinutes: 30,
      cohortId: null,
    };

    const outcome = await generateExam(config, adminId, fake);
    expect(outcome.status).toBe("FAILED");
    if (outcome.status !== "FAILED") throw new Error("unreachable");
    expect(outcome.errorMessage).not.toContain("simulated provider failure");

    const job = await prisma.examGenerationJob.findUnique({ where: { id: outcome.jobId } });
    expect(job!.status).toBe("FAILED");
    expect(job!.resultExamId).toBeNull();
    const examCount = await prisma.exam.count({ where: { title: config.title } });
    expect(examCount).toBe(0);
  });

  it("injects recent same-topic summaries as negative examples, never the full raw prompt", async () => {
    const adminId = await testAdminId();
    const fake = new FakeAiClient();
    fake.mcqQueue = [mcq("First", "first-topic-summary"), mcq("Second", "second-topic-summary")];
    fake.embeddings = [[1, 0], [0, 1]];

    const config: GenerationConfig = {
      type: ExamType.MCQ,
      title: `Avoid summaries ${Date.now()}`,
      topics: [uniqueTopic("Flexbox")],
      count: 2,
      difficulty: { EASY: 100, MEDIUM: 0, HARD: 0 },
      totalMarks: 10,
      durationMinutes: 30,
      cohortId: null,
    };

    await generateExam(config, adminId, fake);
    expect(fake.avoidSummariesSeen[0]).toEqual([]); // nothing generated yet for this topic
    expect(fake.avoidSummariesSeen[1]).toEqual(["first-topic-summary"]);
  });
});

describe("generateExam — PRACTICAL pipeline and hidden-test-case security", () => {
  it("splits challenge marks and public/hidden test-case weights, and the hidden cases stay invisible to the student run-tests endpoint", async () => {
    const adminId = await testAdminId();
    const fake = new FakeAiClient();
    const coding: GeneratedCodingQuestion = {
      businessContext: "Build a checkout page",
      functionalRequirements: ["Must validate card number"],
      uiRequirements: ["Responsive layout"],
      technicalConstraints: ["No external libraries"],
      deliverables: ["index.html", "styles.css"],
      acceptanceCriteria: ["Form shows an error for an invalid card"],
      summary: "checkout page with card validation",
      publicTestCases: [
        { label: "Public sample — has heading", kind: PracticalTestKind.HTML_SELECTOR, targetFile: "index.html", expression: "h1" },
      ],
      hiddenTestCases: [
        { label: "SECRET validation check", kind: PracticalTestKind.FILE_REGEX, targetFile: "index.html", expression: "super-secret-pattern" },
      ],
    };
    fake.codingQueue = [coding];
    fake.embeddings = [[1, 0]];

    const config: GenerationConfig = {
      type: ExamType.PRACTICAL,
      title: `Generated practical ${Date.now()}`,
      topics: [uniqueTopic("Checkout")],
      count: 1,
      difficulty: { EASY: 100, MEDIUM: 0, HARD: 0 },
      totalMarks: 10,
      durationMinutes: 60,
      cohortId: null,
      publicWeightPct: 0.3,
    };

    const outcome = await generateExam(config, adminId, fake);
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") throw new Error("unreachable");

    const testCases = await prisma.practicalTestCase.findMany({ where: { examId: outcome.examId } });
    expect(testCases.length).toBe(2);
    const publicCase = testCases.find((t) => !t.isHidden)!;
    const hiddenCase = testCases.find((t) => t.isHidden)!;
    expect(publicCase.points + hiddenCase.points).toBe(10);
    expect(hiddenCase.points).toBeGreaterThan(publicCase.points); // 70/30 split

    // End-to-end through the real Phase 1 confidentiality filter.
    const student = await createTestStudent();
    const assignment = await prisma.examAssignment.create({ data: { examId: outcome.examId, studentId: student.id } });
    const token = await loginAsStudent(student.email);
    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical`, { headers: authHeaders });
    const res = await fetch(`${baseUrl}/api/student/assignments/${assignment.id}/practical/run-tests`, {
      method: "POST",
      headers: authHeaders,
    });
    const raw = await res.text();
    expect(raw).not.toContain("SECRET");
    expect(raw).not.toContain("super-secret-pattern");
    const report = JSON.parse(raw) as { results: unknown[] };
    expect(report.results.length).toBe(1);
  }, 20_000);
});

describe("POST /api/exams/generate — full route success path (injected fake client via test override, zero network calls)", () => {
  it("returns the generated exam inactive (pending review) with topic coverage and difficulty distribution", async () => {
    const fake = new FakeAiClient();
    const topic = uniqueTopic("Route-success");
    fake.mcqQueue = [mcq("Route success Q1", "route success scenario 1"), mcq("Route success Q2", "route success scenario 2")];
    fake.embeddings = [[1, 0], [0, 1]];
    setAiClientOverrideForTests(fake);

    const res = await fetch(`${baseUrl}/api/exams/generate`, {
      method: "POST",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "MCQ",
        title: `Route-generated exam ${Date.now()}`,
        topics: [topic],
        count: 2,
        difficulty: { EASY: 100, MEDIUM: 0, HARD: 0 },
        totalMarks: 20,
        durationMinutes: 30,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.exam.isActive).toBe(false); // review-before-publish, not immediately assignable
    expect(body.exam.questions.length).toBe(2);
    expect(body.topicCoverage).toEqual({ [topic]: 2 });
    expect(body.difficultyDistribution).toEqual({ EASY: 2 });
  });

  it("rejects a second concurrent request from the same admin with 409 while the first is in flight", async () => {
    const fake = new FakeAiClient();
    const topic = uniqueTopic("Route-concurrency");
    // Never resolves until released below — keeps the lock held so the
    // second request below is guaranteed to observe it.
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    fake.mcqQueue = [mcq("Slow Q1", "slow scenario")];
    fake.embeddings = [[1, 0]];
    const originalEmbed = fake.embed.bind(fake);
    fake.embed = async (text: string) => {
      await gate;
      return originalEmbed(text);
    };
    setAiClientOverrideForTests(fake);

    const body = JSON.stringify({
      type: "MCQ",
      title: `Concurrency exam ${Date.now()}`,
      topics: [topic],
      count: 1,
      difficulty: { EASY: 100, MEDIUM: 0, HARD: 0 },
      totalMarks: 10,
      durationMinutes: 30,
    });

    const first = fetch(`${baseUrl}/api/exams/generate`, {
      method: "POST",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body,
    });
    // Give the first request time to acquire the lock before firing the second.
    await new Promise((r) => setTimeout(r, 50));
    const second = await fetch(`${baseUrl}/api/exams/generate`, {
      method: "POST",
      headers: { ...superHeaders, "Content-Type": "application/json" },
      body,
    });
    expect(second.status).toBe(409);

    releaseFirst();
    const firstRes = await first;
    expect(firstRes.status).toBe(201);
  });
});
