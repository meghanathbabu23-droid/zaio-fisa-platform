import { describe, it, expect } from "vitest";
import { validateGeneratedCodingQuestion, validateGeneratedMcq } from "../src/lib/aiResponseValidation.js";

describe("validateGeneratedMcq", () => {
  const valid = { prompt: "What tag defines a link?", options: ["<a>", "<div>", "<p>", "<span>"], correctIndex: 0, summary: "link tag" };

  it("accepts a well-formed response", () => {
    expect(validateGeneratedMcq(valid)).toEqual([]);
  });

  it("rejects a non-object response", () => {
    expect(validateGeneratedMcq(null)).not.toEqual([]);
    expect(validateGeneratedMcq("not an object")).not.toEqual([]);
    expect(validateGeneratedMcq(undefined)).not.toEqual([]);
  });

  it("rejects a missing or empty prompt", () => {
    expect(validateGeneratedMcq({ ...valid, prompt: "" })).toContain("prompt missing or empty");
    expect(validateGeneratedMcq({ ...valid, prompt: undefined })).toContain("prompt missing or empty");
  });

  it("rejects options that aren't exactly 4 non-empty strings", () => {
    expect(validateGeneratedMcq({ ...valid, options: ["a", "b", "c"] })[0]).toMatch(/options/);
    expect(validateGeneratedMcq({ ...valid, options: ["a", "b", "c", ""] })[0]).toMatch(/options/);
    expect(validateGeneratedMcq({ ...valid, options: ["a", "b", "c", 4] })[0]).toMatch(/options/);
    expect(validateGeneratedMcq({ ...valid, options: "not an array" })[0]).toMatch(/options/);
  });

  it("rejects an out-of-range or non-integer correctIndex", () => {
    expect(validateGeneratedMcq({ ...valid, correctIndex: 4 })[0]).toMatch(/correctIndex/);
    expect(validateGeneratedMcq({ ...valid, correctIndex: -1 })[0]).toMatch(/correctIndex/);
    expect(validateGeneratedMcq({ ...valid, correctIndex: 1.5 })[0]).toMatch(/correctIndex/);
    expect(validateGeneratedMcq({ ...valid, correctIndex: "0" })[0]).toMatch(/correctIndex/);
  });

  it("rejects a missing summary", () => {
    expect(validateGeneratedMcq({ ...valid, summary: "" })).toContain("summary missing or empty");
  });

  it("reports every problem at once, not just the first", () => {
    const problems = validateGeneratedMcq({ prompt: "", options: [], correctIndex: 99, summary: "" });
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });

  it("never includes the actual malformed value in a problem message (untrusted model output)", () => {
    const sensitive = "SECRET_MARKER_VALUE_12345";
    const problems = validateGeneratedMcq({ prompt: sensitive, options: [1, 2, 3], correctIndex: 99, summary: 7 });
    for (const p of problems) {
      expect(p).not.toContain(sensitive);
    }
  });
});

describe("validateGeneratedCodingQuestion", () => {
  const validTestCase = { label: "Has heading", kind: "HTML_SELECTOR", expression: "h1" };
  const valid = {
    businessContext: "Build a checkout page",
    functionalRequirements: ["Must validate email"],
    uiRequirements: ["Responsive layout"],
    technicalConstraints: ["No external libraries"],
    deliverables: ["index.html"],
    acceptanceCriteria: ["Form submits"],
    summary: "checkout page",
    publicTestCases: [validTestCase],
    hiddenTestCases: [validTestCase],
  };

  it("accepts a well-formed response", () => {
    expect(validateGeneratedCodingQuestion(valid)).toEqual([]);
  });

  it("rejects a non-object response", () => {
    expect(validateGeneratedCodingQuestion(null)).not.toEqual([]);
  });

  it("rejects a missing businessContext or summary", () => {
    expect(validateGeneratedCodingQuestion({ ...valid, businessContext: "" })).toContain("businessContext missing or empty");
    expect(validateGeneratedCodingQuestion({ ...valid, summary: "" })).toContain("summary missing or empty");
  });

  it("rejects a string-array field that isn't an array of strings", () => {
    expect(validateGeneratedCodingQuestion({ ...valid, functionalRequirements: "not an array" })[0]).toMatch(
      /functionalRequirements/
    );
    expect(validateGeneratedCodingQuestion({ ...valid, uiRequirements: [1, 2] })[0]).toMatch(/uiRequirements/);
  });

  it("rejects empty or missing test-case arrays", () => {
    expect(validateGeneratedCodingQuestion({ ...valid, publicTestCases: [] })).toContain(
      "publicTestCases must be a non-empty array"
    );
    expect(validateGeneratedCodingQuestion({ ...valid, hiddenTestCases: undefined })).toContain(
      "hiddenTestCases must be a non-empty array"
    );
  });

  it("rejects a test case with an unrecognized kind", () => {
    const problems = validateGeneratedCodingQuestion({
      ...valid,
      publicTestCases: [{ ...validTestCase, kind: "NOT_A_REAL_KIND" }],
    });
    expect(problems.some((p) => p.includes("not a recognized PracticalTestKind"))).toBe(true);
  });

  it("rejects a test case with a missing label or expression", () => {
    const problems = validateGeneratedCodingQuestion({
      ...valid,
      hiddenTestCases: [{ label: "", kind: "HTML_SELECTOR", expression: "" }],
    });
    expect(problems.some((p) => p.includes("label missing"))).toBe(true);
    expect(problems.some((p) => p.includes("expression missing"))).toBe(true);
  });
});
