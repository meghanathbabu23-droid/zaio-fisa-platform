import { describe, it, expect, vi } from "vitest";
import OpenAI from "openai";
import { AiProviderError, openAiSafeErrorLogFromApiError, RealAiClient } from "../src/lib/aiClient.js";
import { aiConfig } from "../src/lib/aiConfig.js";

/**
 * RealAiClient's request/response/error-handling logic, exercised with an
 * injected fetchFn — never a real network call, never requires a real
 * GEMINI_API_KEY/VOYAGE_API_KEY (this test environment forces both empty;
 * see vitest.config.ts). Mirrors the FakeAiClient pattern already used in
 * questionGenerator.test.ts, but one level deeper: this is what proves
 * RealAiClient's own HTTP contract handling is correct, which that file's
 * fake can never exercise.
 */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("RealAiClient.generateMcq — Gemini adapter", () => {
  it("sends the correct endpoint, headers, and structured-output request body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { output_text: JSON.stringify({ prompt: "Q", options: ["A", "B", "C", "D"], correctIndex: 0, summary: "s" }) })
    );
    const client = new RealAiClient(fetchFn as unknown as typeof fetch);

    await client.generateMcq({ topic: "Flexbox", difficulty: "EASY", avoidSummaries: ["old scenario"] });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(init.headers["x-goog-api-key"]).toBe(aiConfig.gemini.apiKey);
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body.model).toBe(aiConfig.gemini.model);
    expect(body.input).toContain("Flexbox");
    expect(body.input).toContain("old scenario");
    expect(body.response_format.mime_type).toBe("application/json");
    expect(body.response_format.schema.required).toEqual(["prompt", "options", "correctIndex", "summary"]);
  });

  it("parses a well-formed response via the output_text field", async () => {
    const generated = { prompt: "What tag?", options: ["<a>", "<b>", "<c>", "<d>"], correctIndex: 0, summary: "tags" };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { output_text: JSON.stringify(generated) }));
    const client = new RealAiClient(fetchFn as unknown as typeof fetch);

    const result = await client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] });
    expect(result).toEqual(generated);
  });

  it("falls back to outputs[0].text when output_text is absent", async () => {
    const generated = { prompt: "Q", options: ["A", "B", "C", "D"], correctIndex: 1, summary: "s" };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { outputs: [{ text: JSON.stringify(generated) }] }));
    const client = new RealAiClient(fetchFn as unknown as typeof fetch);

    const result = await client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] });
    expect(result).toEqual(generated);
  });

  it("falls back to the classic candidates[0].content.parts[0].text shape", async () => {
    const generated = { prompt: "Q", options: ["A", "B", "C", "D"], correctIndex: 2, summary: "s" };
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] } }] })
    );
    const client = new RealAiClient(fetchFn as unknown as typeof fetch);

    const result = await client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] });
    expect(result).toEqual(generated);
  });

  it("throws AiProviderError(RATE_LIMITED) on a 429, never silently falling back to another model", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(429, { error: "rate limited" }));
    const client = new RealAiClient(fetchFn as unknown as typeof fetch);

    await expect(client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] })).rejects.toMatchObject({
      category: "RATE_LIMITED",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1); // no automatic retry-with-different-model inside the client itself
  });

  it("throws AiProviderError(AUTH_ERROR) on a 401/403", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, { error: "bad key" }));
    const client = new RealAiClient(fetchFn as unknown as typeof fetch);
    await expect(client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] })).rejects.toMatchObject({
      category: "AUTH_ERROR",
    });
  });

  it("throws AiProviderError(INVALID_RESPONSE) when no recognizable output-text field exists", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { something_unexpected: true }));
    const client = new RealAiClient(fetchFn as unknown as typeof fetch);
    await expect(client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] })).rejects.toMatchObject({
      category: "INVALID_RESPONSE",
    });
  });

  it("throws AiProviderError(INVALID_RESPONSE) when output_text isn't valid JSON", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { output_text: "not json{{{" }));
    const client = new RealAiClient(fetchFn as unknown as typeof fetch);
    await expect(client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] })).rejects.toMatchObject({
      category: "INVALID_RESPONSE",
    });
  });

  it("throws AiProviderError(NETWORK_ERROR) when the request itself fails", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const client = new RealAiClient(fetchFn as unknown as typeof fetch);
    await expect(client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] })).rejects.toMatchObject({
      category: "NETWORK_ERROR",
    });
  });

  it("is an instance of AiProviderError specifically, not a generic Error", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    const client = new RealAiClient(fetchFn as unknown as typeof fetch);
    try {
      await client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AiProviderError);
    }
  });
});

function mockOpenAiCreate() {
  return vi.fn();
}

function openAiLlmClient(
  create: ReturnType<typeof mockOpenAiCreate>,
  embedCreate: ReturnType<typeof vi.fn> = vi.fn()
) {
  const openai = {
    chat: { completions: { create } },
    embeddings: { create: embedCreate },
  } as unknown as OpenAI;
  return new RealAiClient(vi.fn() as unknown as typeof fetch, { llmProvider: "openai", openai });
}

describe("RealAiClient.generateMcq — OpenAI adapter", () => {
  const generated = { prompt: "What tag?", options: ["<a>", "<b>", "<c>", "<d>"], correctIndex: 0, summary: "tags" };

  it("requests structured JSON output with the configured OpenAI model", async () => {
    const create = mockOpenAiCreate().mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(generated) } }],
    });
    const client = openAiLlmClient(create);
    await client.generateMcq({ topic: "Flexbox", difficulty: "EASY", avoidSummaries: ["old"] });
    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0]![0];
    expect(args.model).toBe(aiConfig.openai.model);
    expect(args.response_format?.type).toBe("json_schema");
    expect(args.response_format?.json_schema?.name).toBe("mcq_question");
    expect(args.response_format?.json_schema?.strict).toBe(true);
    expect(args.response_format?.json_schema?.schema).toMatchObject({ additionalProperties: false });
    expect(args.messages[0].content).toContain("Flexbox");
    expect(args.messages[0].content).toContain("old");
  });

  it("parses a well-formed MCQ JSON payload", async () => {
    const create = mockOpenAiCreate().mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(generated) } }],
    });
    const client = openAiLlmClient(create);
    await expect(client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] })).resolves.toEqual(
      generated
    );
  });

  it("throws INVALID_RESPONSE on model refusal", async () => {
    const create = mockOpenAiCreate().mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { refusal: "I cannot help", content: null } }],
    });
    const client = openAiLlmClient(create);
    await expect(client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] })).rejects.toMatchObject({
      category: "INVALID_RESPONSE",
    });
  });

  it("throws INVALID_RESPONSE when finish_reason is length", async () => {
    const create = mockOpenAiCreate().mockResolvedValue({
      choices: [{ finish_reason: "length", message: { content: "{}" } }],
    });
    const client = openAiLlmClient(create);
    await expect(client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] })).rejects.toMatchObject({
      category: "INVALID_RESPONSE",
    });
  });

  it("throws AiProviderError(RATE_LIMITED) on OpenAI 429", async () => {
    const create = mockOpenAiCreate().mockRejectedValue(new OpenAI.APIError(429, undefined, "rate", undefined));
    const client = openAiLlmClient(create);
    await expect(client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] })).rejects.toMatchObject({
      category: "RATE_LIMITED",
    });
  });

  it("throws AiProviderError(AUTH_ERROR) on OpenAI 401", async () => {
    const create = mockOpenAiCreate().mockRejectedValue(new OpenAI.APIError(401, undefined, "auth", undefined));
    const client = openAiLlmClient(create);
    await expect(client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] })).rejects.toMatchObject({
      category: "AUTH_ERROR",
    });
  });

  it("throws INVALID_RESPONSE when message content is not valid JSON", async () => {
    const create = mockOpenAiCreate().mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "not-json" } }],
    });
    const client = openAiLlmClient(create);
    await expect(client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] })).rejects.toMatchObject({
      category: "INVALID_RESPONSE",
    });
  });

  it("logs safe OpenAI error fields and surfaces param on schema HTTP 400", async () => {
    const headers = new Headers({ "x-request-id": "req_schema_400_test" });
    const apiBody = {
      message:
        "Invalid schema for response_format 'mcq_question': In context=(), 'additionalProperties' is required to be supplied and to be false.",
      type: "invalid_request_error",
      param: "response_format",
      code: null,
    };
    const create = mockOpenAiCreate().mockRejectedValue(new OpenAI.APIError(400, apiBody, undefined, headers));
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = openAiLlmClient(create);
    await expect(client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] })).rejects.toMatchObject({
      category: "UNKNOWN",
      message: expect.stringContaining("param=response_format"),
    });
    expect(logSpy).toHaveBeenCalledWith(
      "[aiClient] OpenAI API error",
      expect.stringContaining("req_schema_400_test")
    );
    const logged = JSON.parse(String(logSpy.mock.calls[0]![1])) as Record<string, unknown>;
    expect(logged).toMatchObject({
      operation: "chat.completions",
      httpStatus: 400,
      errorType: "invalid_request_error",
      param: "response_format",
      requestId: "req_schema_400_test",
    });
    expect(String(logged.message)).toContain("additionalProperties");
    logSpy.mockRestore();
  });
});

describe("openAiSafeErrorLogFromApiError", () => {
  it("extracts only safe fields from an OpenAI.APIError", () => {
    const headers = new Headers({ "x-request-id": "req_abc" });
    const err = new OpenAI.APIError(
      400,
      { message: "bad schema", type: "invalid_request_error", param: "response_format", code: "x" },
      undefined,
      headers
    );
    expect(openAiSafeErrorLogFromApiError("chat.completions", err)).toEqual({
      operation: "chat.completions",
      httpStatus: 400,
      message: "bad schema",
      errorType: "invalid_request_error",
      errorCode: "x",
      param: "response_format",
      requestId: "req_abc",
    });
  });
});

describe("RealAiClient.generateCodingQuestion — OpenAI adapter", () => {
  const generated = {
    businessContext: "Shop",
    functionalRequirements: ["Cart"],
    uiRequirements: ["Responsive"],
    technicalConstraints: ["No libs"],
    deliverables: ["index.html"],
    acceptanceCriteria: ["Works"],
    summary: "checkout",
    publicTestCases: [{ label: "Has h1", kind: "HTML_SELECTOR", targetFile: "index.html", expression: "h1" }],
    hiddenTestCases: [],
  };

  it("uses the coding_question schema name and returns parsed JSON", async () => {
    const create = mockOpenAiCreate().mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(generated) } }],
    });
    const client = openAiLlmClient(create);
    const result = await client.generateCodingQuestion({ topic: "Forms", difficulty: "MEDIUM", avoidSummaries: [] });
    expect(create.mock.calls[0]![0].response_format?.json_schema?.name).toBe("coding_question");
    expect(result.summary).toBe("checkout");
  });
});

describe("RealAiClient.generateMcq — Gemini remains default with injected fetch", () => {
  it("does not call OpenAI when llmProvider is gemini", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { output_text: JSON.stringify({ prompt: "Q", options: ["A", "B", "C", "D"], correctIndex: 0, summary: "s" }) })
    );
    const create = mockOpenAiCreate();
    const openai = { chat: { completions: { create } } } as unknown as OpenAI;
    const client = new RealAiClient(fetchFn as unknown as typeof fetch, { llmProvider: "gemini", openai });
    await client.generateMcq({ topic: "HTML", difficulty: "EASY", avoidSummaries: [] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("RealAiClient.embed — Voyage adapter (gemini provider)", () => {
  it("sends voyage-4-lite with an explicit output_dimension, and parses the returned vector", async () => {
    const vector = Array.from({ length: 1024 }, () => Math.random());
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ embedding: vector }] }));
    const client = new RealAiClient(fetchFn as unknown as typeof fetch, { llmProvider: "gemini" });

    const result = await client.embed("some question text");

    expect(result).toEqual(vector);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("voyage-4-lite");
    expect(body.output_dimension).toBe(1024);
    expect(body.input).toEqual(["some question text"]);
  });

  it("throws AiProviderError(RATE_LIMITED) on a 429", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(429, {}));
    const client = new RealAiClient(fetchFn as unknown as typeof fetch, { llmProvider: "gemini" });
    await expect(client.embed("text")).rejects.toMatchObject({ category: "RATE_LIMITED" });
  });

  it("throws AiProviderError(AUTH_ERROR) on a 401", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    const client = new RealAiClient(fetchFn as unknown as typeof fetch, { llmProvider: "gemini" });
    await expect(client.embed("text")).rejects.toMatchObject({ category: "AUTH_ERROR" });
  });

  it("throws AiProviderError(INVALID_RESPONSE) when no embedding vector is present", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    const client = new RealAiClient(fetchFn as unknown as typeof fetch, { llmProvider: "gemini" });
    await expect(client.embed("text")).rejects.toMatchObject({ category: "INVALID_RESPONSE" });
  });

  it("throws AiProviderError(NETWORK_ERROR) when the request itself fails", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("DNS failure"));
    const client = new RealAiClient(fetchFn as unknown as typeof fetch, { llmProvider: "gemini" });
    await expect(client.embed("text")).rejects.toMatchObject({ category: "NETWORK_ERROR" });
  });

  it("does not call Voyage when llmProvider is openai", async () => {
    const fetchFn = vi.fn();
    const vector = [0.1, 0.2];
    const embedCreate = vi.fn().mockResolvedValue({ data: [{ embedding: vector }] });
    const create = mockOpenAiCreate();
    const client = openAiLlmClient(create, embedCreate);
    await expect(client.embed("text")).resolves.toEqual(vector);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(embedCreate).toHaveBeenCalledTimes(1);
  });
});

describe("RealAiClient.embed — OpenAI adapter", () => {
  it("requests text-embedding-3-small with explicit dimensions and parses the vector", async () => {
    const vector = Array.from({ length: 1024 }, (_, i) => i / 1024);
    const embedCreate = vi.fn().mockResolvedValue({ data: [{ embedding: vector }] });
    const client = openAiLlmClient(mockOpenAiCreate(), embedCreate);
    const result = await client.embed("some question text");
    expect(result).toEqual(vector);
    expect(embedCreate).toHaveBeenCalledWith({
      model: aiConfig.openai.embeddingModel,
      input: "some question text",
      dimensions: aiConfig.openai.embeddingDimensions,
    });
  });

  it("throws AiProviderError(RATE_LIMITED) on OpenAI embeddings 429", async () => {
    const embedCreate = vi.fn().mockRejectedValue(new OpenAI.APIError(429, undefined, "rate", undefined));
    const client = openAiLlmClient(mockOpenAiCreate(), embedCreate);
    await expect(client.embed("text")).rejects.toMatchObject({ category: "RATE_LIMITED" });
  });

  it("throws AiProviderError(AUTH_ERROR) on OpenAI embeddings 401", async () => {
    const embedCreate = vi.fn().mockRejectedValue(new OpenAI.APIError(401, undefined, "auth", undefined));
    const client = openAiLlmClient(mockOpenAiCreate(), embedCreate);
    await expect(client.embed("text")).rejects.toMatchObject({ category: "AUTH_ERROR" });
  });

  it("throws AiProviderError(INVALID_RESPONSE) when OpenAI returns no embedding", async () => {
    const embedCreate = vi.fn().mockResolvedValue({ data: [] });
    const client = openAiLlmClient(mockOpenAiCreate(), embedCreate);
    await expect(client.embed("text")).rejects.toMatchObject({ category: "INVALID_RESPONSE" });
  });

  it("throws AiProviderError(NETWORK_ERROR) when embeddings.create rejects non-API errors", async () => {
    const embedCreate = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const client = openAiLlmClient(mockOpenAiCreate(), embedCreate);
    await expect(client.embed("text")).rejects.toMatchObject({ category: "NETWORK_ERROR" });
  });
});
