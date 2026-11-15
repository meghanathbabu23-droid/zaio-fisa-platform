import type { PracticalTestKind } from "@prisma/client";
import OpenAI from "openai";
import { aiConfig, type LlmProvider } from "./aiConfig.js";

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
 * Injectable AI-provider boundary. Generation goes through Gemini
 * (structured JSON output via a response schema, never free text parsed
 * by regex); similarity embedding goes through Voyage when gemini or
 * OpenAI embeddings when openai. Tests inject a
 * deterministic fake implementation and never construct RealAiClient or
 * hit a real network endpoint — see test/questionGenerator.test.ts.
 */
export interface AiClient {
  generateMcq(params: McqGenerationParams): Promise<GeneratedMcq>;
  generateCodingQuestion(params: CodingGenerationParams): Promise<GeneratedCodingQuestion>;
  embed(text: string): Promise<number[]>;
}

const MCQ_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
    correctIndex: { type: "integer", minimum: 0, maximum: 3 },
    summary: { type: "string", description: "One short sentence describing this question's scenario." },
  },
  required: ["prompt", "options", "correctIndex", "summary"],
};

const CODING_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    businessContext: { type: "string" },
    functionalRequirements: { type: "array", items: { type: "string" } },
    uiRequirements: { type: "array", items: { type: "string" } },
    technicalConstraints: { type: "array", items: { type: "string" } },
    deliverables: { type: "array", items: { type: "string" } },
    acceptanceCriteria: { type: "array", items: { type: "string" } },
    summary: { type: "string", description: "One short sentence describing this question's scenario." },
    publicTestCases: { type: "array", items: { type: "object" } },
    hiddenTestCases: { type: "array", items: { type: "object" } },
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
};

function buildAvoidClause(avoidSummaries: string[]): string {
  if (avoidSummaries.length === 0) return "";
  return (
    "\n\nAvoid reusing these previously-generated scenarios or their wording " +
    "(write a genuinely different scenario and phrasing):\n" +
    avoidSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")
  );
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly category: "RATE_LIMITED" | "AUTH_ERROR" | "INVALID_RESPONSE" | "NETWORK_ERROR" | "UNKNOWN"
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

type FetchFn = typeof fetch;

/** Injectable overrides for tests — never used in production call sites. */
export type RealAiClientDeps = {
  llmProvider?: LlmProvider;
  openai?: OpenAI;
};

/**
 * Real LLM (Gemini or OpenAI per aiConfig) + matching embeddings. Never
 * constructed or called by any test directly against the network — tests
 * either use FakeAiClient (questionGenerator.test.ts) or construct
 * RealAiClient with an injected fetchFn / mock OpenAI client (aiClient.test.ts).
 * Only ever constructed for real use by getAiClient() when
 * aiConfig.isConfigured is true.
 */
export class RealAiClient implements AiClient {
  private readonly deps: RealAiClientDeps;
  private openaiClient: OpenAI | null;

  constructor(
    private readonly fetchFn: FetchFn = fetch,
    deps: RealAiClientDeps = {}
  ) {
    this.deps = deps;
    this.openaiClient = deps.openai ?? null;
  }

  private resolveLlmProvider(): LlmProvider {
    return this.deps.llmProvider ?? aiConfig.llmProvider;
  }

  private getOpenAI(): OpenAI {
    if (!this.openaiClient) {
      this.openaiClient = new OpenAI({
        apiKey: aiConfig.openai.apiKey,
        fetch: this.fetchFn,
      });
    }
    return this.openaiClient;
  }

  private async callGemini(input: string, responseSchema: object): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "x-goog-api-key": aiConfig.gemini.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: aiConfig.gemini.model,
          input,
          response_format: { type: "text", mime_type: "application/json", schema: responseSchema },
        }),
      });
    } catch (e) {
      throw new AiProviderError(
        `Gemini request failed: ${e instanceof Error ? e.message : "network error"}`,
        "NETWORK_ERROR"
      );
    }

    if (res.status === 429) {
      throw new AiProviderError("Gemini rate limit exceeded", "RATE_LIMITED");
    }
    if (res.status === 401 || res.status === 403) {
      throw new AiProviderError("Gemini authentication failed (check GEMINI_API_KEY)", "AUTH_ERROR");
    }
    if (!res.ok) {
      throw new AiProviderError(`Gemini request failed with status ${res.status}`, "UNKNOWN");
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AiProviderError("Gemini response was not valid JSON", "INVALID_RESPONSE");
    }

    // The documented SDK-level field is `output_text`; the raw REST
    // envelope's exact path isn't fully documented, so this defensively
    // tries every plausible shape (current Interactions API, and the
    // classic generateContent candidates[] shape as a fallback) rather
    // than assuming one with more confidence than is actually warranted.
    const outputText = extractGeminiOutputText(body);
    if (outputText === null) {
      throw new AiProviderError("Gemini response did not contain recognizable output text", "INVALID_RESPONSE");
    }

    try {
      return JSON.parse(outputText);
    } catch {
      throw new AiProviderError("Gemini output_text was not valid JSON", "INVALID_RESPONSE");
    }
  }

  private async callOpenAI(
    input: string,
    responseSchema: object,
    schemaName: string,
    strictSchema: boolean
  ): Promise<unknown> {
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await this.getOpenAI().chat.completions.create({
        model: aiConfig.openai.model,
        messages: [{ role: "user", content: input }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: schemaName,
            strict: strictSchema,
            schema: responseSchema as Record<string, unknown>,
          },
        },
      });
    } catch (e) {
      if (e instanceof OpenAI.APIError) {
        if (e.status === 429) {
          throw new AiProviderError("OpenAI rate limit exceeded", "RATE_LIMITED");
        }
        if (e.status === 401 || e.status === 403) {
          throw new AiProviderError("OpenAI authentication failed (check OPENAI_API_KEY)", "AUTH_ERROR");
        }
        throw new AiProviderError(`OpenAI request failed with status ${e.status ?? "unknown"}`, "UNKNOWN");
      }
      throw new AiProviderError(
        `OpenAI request failed: ${e instanceof Error ? e.message : "network error"}`,
        "NETWORK_ERROR"
      );
    }

    const choice = completion.choices[0];
    if (!choice) {
      throw new AiProviderError("OpenAI response contained no choices", "INVALID_RESPONSE");
    }
    if (choice.finish_reason === "content_filter") {
      throw new AiProviderError("OpenAI refused the request (content filter)", "INVALID_RESPONSE");
    }
    if (choice.finish_reason === "length") {
      throw new AiProviderError("OpenAI response was incomplete (length)", "INVALID_RESPONSE");
    }
    const message = choice.message;
    if (message.refusal) {
      throw new AiProviderError("OpenAI refused to generate content", "INVALID_RESPONSE");
    }
    const content = message.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new AiProviderError("OpenAI response did not contain message content", "INVALID_RESPONSE");
    }
    try {
      return JSON.parse(content);
    } catch {
      throw new AiProviderError("OpenAI message content was not valid JSON", "INVALID_RESPONSE");
    }
  }

  async generateMcq(params: McqGenerationParams): Promise<GeneratedMcq> {
    const input =
      `Write one fresh, scenario-based multiple-choice question on the topic "${params.topic}" ` +
      `at ${params.difficulty} difficulty. Exactly 4 options, exactly one correct answer, ` +
      `plausible distractors.${buildAvoidClause(params.avoidSummaries)}`;
    if (this.resolveLlmProvider() === "openai") {
      return (await this.callOpenAI(input, MCQ_RESPONSE_SCHEMA, "mcq_question", true)) as GeneratedMcq;
    }
    return (await this.callGemini(input, MCQ_RESPONSE_SCHEMA)) as GeneratedMcq;
  }

  async generateCodingQuestion(params: CodingGenerationParams): Promise<GeneratedCodingQuestion> {
    const input =
      `Write one fresh, realistic workplace HTML/CSS/JS coding question on the topic "${params.topic}" ` +
      `at ${params.difficulty} difficulty (e.g. a checkout page, dashboard, booking form, filter UI, ` +
      `or API-driven display — pick a scenario different from any avoided below). Include public sample ` +
      `test cases and private hidden test cases in the DOM_BEHAVIOR shape ` +
      `({steps:[{action,selector,value}], assert:{selector,condition,value}}) or static-check kinds ` +
      `(HTML_CONTAINS/CSS_CONTAINS/JS_CONTAINS/HTML_SELECTOR/FILE_REGEX).${buildAvoidClause(params.avoidSummaries)}`;
    if (this.resolveLlmProvider() === "openai") {
      return (await this.callOpenAI(input, CODING_RESPONSE_SCHEMA, "coding_question", false)) as GeneratedCodingQuestion;
    }
    return (await this.callGemini(input, CODING_RESPONSE_SCHEMA)) as GeneratedCodingQuestion;
  }

  async embed(text: string): Promise<number[]> {
    if (this.resolveLlmProvider() === "openai") {
      return this.embedOpenAI(text);
    }
    return this.embedVoyage(text);
  }

  private async embedOpenAI(text: string): Promise<number[]> {
    let response: OpenAI.Embeddings.CreateEmbeddingResponse;
    try {
      response = await this.getOpenAI().embeddings.create({
        model: aiConfig.openai.embeddingModel,
        input: text,
        dimensions: aiConfig.openai.embeddingDimensions,
      });
    } catch (e) {
      if (e instanceof OpenAI.APIError) {
        if (e.status === 429) {
          throw new AiProviderError("OpenAI embeddings rate limit exceeded", "RATE_LIMITED");
        }
        if (e.status === 401 || e.status === 403) {
          throw new AiProviderError("OpenAI authentication failed (check OPENAI_API_KEY)", "AUTH_ERROR");
        }
        throw new AiProviderError(`OpenAI embeddings request failed with status ${e.status ?? "unknown"}`, "UNKNOWN");
      }
      throw new AiProviderError(
        `OpenAI embeddings request failed: ${e instanceof Error ? e.message : "network error"}`,
        "NETWORK_ERROR"
      );
    }
    const vector = response.data[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new AiProviderError("OpenAI response did not contain an embedding vector", "INVALID_RESPONSE");
    }
    return vector;
  }

  private async embedVoyage(text: string): Promise<number[]> {
    let res: Response;
    try {
      res = await this.fetchFn("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aiConfig.voyage.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: [text],
          model: aiConfig.voyage.model,
          output_dimension: aiConfig.voyage.outputDimension,
        }),
      });
    } catch (e) {
      throw new AiProviderError(
        `Voyage request failed: ${e instanceof Error ? e.message : "network error"}`,
        "NETWORK_ERROR"
      );
    }

    if (res.status === 429) {
      throw new AiProviderError("Voyage rate limit exceeded", "RATE_LIMITED");
    }
    if (res.status === 401 || res.status === 403) {
      throw new AiProviderError("Voyage authentication failed (check VOYAGE_API_KEY)", "AUTH_ERROR");
    }
    if (!res.ok) {
      throw new AiProviderError(`Voyage embeddings request failed with status ${res.status}`, "UNKNOWN");
    }

    let body: { data?: { embedding: number[] }[] };
    try {
      body = (await res.json()) as { data?: { embedding: number[] }[] };
    } catch {
      throw new AiProviderError("Voyage response was not valid JSON", "INVALID_RESPONSE");
    }
    const vector = body.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new AiProviderError("Voyage response did not contain an embedding vector", "INVALID_RESPONSE");
    }
    return vector;
  }
}

/** Tries every plausible field path for Gemini's structured-output text,
 * since the raw REST envelope isn't fully documented (see RealAiClient's
 * callGemini doc comment) — returns null, never throws, if nothing matches
 * so the caller can raise one clear INVALID_RESPONSE error instead of an
 * unrelated property-access crash. */
function extractGeminiOutputText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  if (typeof obj.output_text === "string") return obj.output_text;
  const outputs = obj.outputs;
  if (Array.isArray(outputs) && typeof outputs[0]?.text === "string") return outputs[0].text as string;
  const candidates = obj.candidates;
  if (Array.isArray(candidates)) {
    const text = (candidates[0] as Record<string, unknown> | undefined)?.content as
      | Record<string, unknown>
      | undefined;
    const parts = text?.parts;
    if (Array.isArray(parts) && typeof parts[0]?.text === "string") return parts[0].text as string;
  }
  return null;
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
