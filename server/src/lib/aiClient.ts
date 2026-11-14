import Anthropic from "@anthropic-ai/sdk";
import type { PracticalTestKind } from "@prisma/client";
import { aiConfig } from "./aiConfig.js";

export type Difficulty = "EASY" | "MEDIUM" | "HARD";

export type McqGenerationParams = {
  topic: string;
  difficulty: Difficulty;
  /** Short scenario summaries of recently-generated questions in the same
   * topic/type bucket, injected as negative examples ("avoid reusing
   * these"). Never raw prompts/completions — see questionGenerator.ts. */
  avoidSummaries: string[];
};

export type GeneratedMcq = {
  prompt: string;
  options: string[];
  correctIndex: number;
  /** Short denormalized scenario description, stored (not the full
   * prompt) for future negative-example reuse — see schema comment on
   * GeneratedQuestionEmbedding. */
  summary: string;
};

export type CodingGenerationParams = {
  topic: string;
  difficulty: Difficulty;
  avoidSummaries: string[];
};

export type GeneratedTestCase = {
  label: string;
  kind: PracticalTestKind;
  targetFile: string | null;
  expression: string;
};

export type GeneratedCodingQuestion = {
  businessContext: string;
  functionalRequirements: string[];
  uiRequirements: string[];
  technicalConstraints: string[];
  deliverables: string[];
  acceptanceCriteria: string[];
  summary: string;
  publicTestCases: GeneratedTestCase[];
  hiddenTestCases: GeneratedTestCase[];
};

/**
 * Injectable AI-provider boundary. Generation goes through Claude
 * (tool-use/structured output, never free text parsed by regex);
 * similarity embedding goes through Voyage. Tests inject a deterministic
 * fake implementation and never construct RealAiClient or hit a real
 * network endpoint — see test/questionGenerator.test.ts.
 */
export interface AiClient {
  generateMcq(params: McqGenerationParams): Promise<GeneratedMcq>;
  generateCodingQuestion(params: CodingGenerationParams): Promise<GeneratedCodingQuestion>;
  embed(text: string): Promise<number[]>;
}

const MCQ_TOOL = {
  name: "submit_mcq_question",
  description: "Submit one freshly-written multiple-choice question.",
  input_schema: {
    type: "object" as const,
    properties: {
      prompt: { type: "string" as const },
      options: { type: "array" as const, items: { type: "string" as const }, minItems: 4, maxItems: 4 },
      correctIndex: { type: "integer" as const, minimum: 0, maximum: 3 },
      summary: { type: "string" as const, description: "One short sentence describing this question's scenario." },
    },
    required: ["prompt", "options", "correctIndex", "summary"],
  },
};

const CODING_TOOL = {
  name: "submit_coding_question",
  description: "Submit one freshly-written real-world HTML/CSS/JS coding question.",
  input_schema: {
    type: "object" as const,
    properties: {
      businessContext: { type: "string" as const },
      functionalRequirements: { type: "array" as const, items: { type: "string" as const } },
      uiRequirements: { type: "array" as const, items: { type: "string" as const } },
      technicalConstraints: { type: "array" as const, items: { type: "string" as const } },
      deliverables: { type: "array" as const, items: { type: "string" as const } },
      acceptanceCriteria: { type: "array" as const, items: { type: "string" as const } },
      summary: { type: "string" as const, description: "One short sentence describing this question's scenario." },
      publicTestCases: { type: "array" as const, items: { type: "object" as const } },
      hiddenTestCases: { type: "array" as const, items: { type: "object" as const } },
    },
    required: [
      "businessContext",
      "functionalRequirements",
      "uiRequirements",
      "technicalConstraints",
      "deliverables",
      "acceptanceCriteria",
      "summary",
      "publicTestCases",
      "hiddenTestCases",
    ],
  },
};

function buildAvoidClause(avoidSummaries: string[]): string {
  if (avoidSummaries.length === 0) return "";
  return (
    "\n\nAvoid reusing these previously-generated scenarios or their wording " +
    "(write a genuinely different scenario and phrasing):\n" +
    avoidSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")
  );
}

/**
 * Real Claude + Voyage implementation. Never constructed or called by any
 * test. Only ever constructed by getAiClient() when aiConfig.isConfigured
 * is true, i.e. only once real API keys exist in server/.env.
 */
export class RealAiClient implements AiClient {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: aiConfig.anthropic.apiKey });
  }

  async generateMcq(params: McqGenerationParams): Promise<GeneratedMcq> {
    const message = await this.anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      tools: [MCQ_TOOL],
      tool_choice: { type: "tool", name: MCQ_TOOL.name },
      messages: [
        {
          role: "user",
          content:
            `Write one fresh, scenario-based multiple-choice question on the topic "${params.topic}" ` +
            `at ${params.difficulty} difficulty. Exactly 4 options, exactly one correct answer, ` +
            `plausible distractors.${buildAvoidClause(params.avoidSummaries)}`,
        },
      ],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") throw new Error("Claude did not return a tool_use block");
    return toolUse.input as GeneratedMcq;
  }

  async generateCodingQuestion(params: CodingGenerationParams): Promise<GeneratedCodingQuestion> {
    const message = await this.anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      tools: [CODING_TOOL],
      tool_choice: { type: "tool", name: CODING_TOOL.name },
      messages: [
        {
          role: "user",
          content:
            `Write one fresh, realistic workplace HTML/CSS/JS coding question on the topic "${params.topic}" ` +
            `at ${params.difficulty} difficulty (e.g. a checkout page, dashboard, booking form, filter UI, ` +
            `or API-driven display — pick a scenario different from any avoided below). Include public sample ` +
            `test cases and private hidden test cases in the DOM_BEHAVIOR shape ` +
            `({steps:[{action,selector,value}], assert:{selector,condition,value}}) or static-check kinds ` +
            `(HTML_CONTAINS/CSS_CONTAINS/JS_CONTAINS/HTML_SELECTOR/FILE_REGEX).${buildAvoidClause(params.avoidSummaries)}`,
        },
      ],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") throw new Error("Claude did not return a tool_use block");
    return toolUse.input as GeneratedCodingQuestion;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiConfig.voyage.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: [text], model: "voyage-3" }),
    });
    if (!res.ok) {
      throw new Error(`Voyage embeddings request failed with status ${res.status}`);
    }
    const body = (await res.json()) as { data: { embedding: number[] }[] };
    return body.data[0].embedding;
  }
}

let cached: RealAiClient | null = null;

/** Returns null when AI generation isn't configured — callers must check
 * for null and respond 503, never construct RealAiClient themselves. */
export function getAiClient(): AiClient | null {
  if (testOverride !== undefined) return testOverride;
  if (!aiConfig.isConfigured) return null;
  if (!cached) cached = new RealAiClient();
  return cached;
}

let testOverride: AiClient | null | undefined;

/** Test-only: forces getAiClient() to return a given fake (or null),
 * bypassing aiConfig.isConfigured/RealAiClient entirely — lets a route-level
 * test exercise the real HTTP success path without ever constructing a
 * real client or making a network call. Call with undefined to clear.
 *
 * Fail-closed even if something ever called this outside a test (a bad
 * import, a future route, a bug): refuses outright in production, so this
 * escape hatch's safety never rests solely on "nothing in production code
 * happens to call it" — the same reasoning server/src/routes/testOtp.ts
 * documents for its own mock-only endpoint. */
export function setAiClientOverrideForTests(client: AiClient | null | undefined): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("setAiClientOverrideForTests must never be called when NODE_ENV=production");
  }
  testOverride = client;
}
