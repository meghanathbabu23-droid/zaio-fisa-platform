/**
 * Runtime validation of what the AI provider actually returned, before
 * questionGenerator.ts uses or persists it. Claude's tool-use schema
 * (aiClient.ts's MCQ_TOOL/CODING_TOOL) is a strong hint, not a guarantee —
 * a provider response that drifts from it (wrong option count, an
 * out-of-range correctIndex, a test-case kind that doesn't exist) was
 * previously used via a blind `as GeneratedMcq`/`as GeneratedCodingQuestion`
 * cast with no check at all. A single silently-malformed question would
 * either crash the generation job with an unhandled TypeError (e.g.
 * `generated.options.join` on a non-array) or, worse, persist a real exam
 * question a student could never answer correctly (correctIndex pointing
 * past the end of options). Every problem string here names a field, never
 * includes the field's actual value, since that value is untrusted
 * model output that could in principle echo something it was told to avoid.
 */

const VALID_TEST_KINDS = new Set<string>([
  "HTML_CONTAINS",
  "CSS_CONTAINS",
  "JS_CONTAINS",
  "HTML_SELECTOR",
  "FILE_REGEX",
  "DOM_BEHAVIOR",
]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function validateGeneratedMcq(input: unknown): string[] {
  if (!input || typeof input !== "object") return ["response was not an object"];
  const { prompt, options, correctIndex, summary } = input as Record<string, unknown>;
  const problems: string[] = [];
  if (!isNonEmptyString(prompt)) problems.push("prompt missing or empty");
  if (!Array.isArray(options) || options.length !== 4 || !options.every(isNonEmptyString)) {
    problems.push("options must be exactly 4 non-empty strings");
  }
  if (typeof correctIndex !== "number" || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    problems.push("correctIndex must be an integer between 0 and 3");
  }
  if (!isNonEmptyString(summary)) problems.push("summary missing or empty");
  return problems;
}

function validateTestCase(tc: unknown, label: string): string[] {
  if (!tc || typeof tc !== "object") return [`${label} test case was not an object`];
  const { label: tcLabel, kind, expression } = tc as Record<string, unknown>;
  const problems: string[] = [];
  if (!isNonEmptyString(tcLabel)) problems.push(`${label} test case label missing or empty`);
  if (typeof kind !== "string" || !VALID_TEST_KINDS.has(kind)) {
    problems.push(`${label} test case kind is not a recognized PracticalTestKind`);
  }
  if (!isNonEmptyString(expression)) problems.push(`${label} test case expression missing or empty`);
  return problems;
}

export function validateGeneratedCodingQuestion(input: unknown): string[] {
  if (!input || typeof input !== "object") return ["response was not an object"];
  const obj = input as Record<string, unknown>;
  const problems: string[] = [];

  if (!isNonEmptyString(obj.businessContext)) problems.push("businessContext missing or empty");
  if (!isNonEmptyString(obj.summary)) problems.push("summary missing or empty");

  for (const field of [
    "functionalRequirements",
    "uiRequirements",
    "technicalConstraints",
    "deliverables",
    "acceptanceCriteria",
  ]) {
    if (!isStringArray(obj[field])) problems.push(`${field} must be an array of strings`);
  }

  if (!Array.isArray(obj.publicTestCases) || obj.publicTestCases.length === 0) {
    problems.push("publicTestCases must be a non-empty array");
  } else {
    for (const tc of obj.publicTestCases) problems.push(...validateTestCase(tc, "public"));
  }
  if (!Array.isArray(obj.hiddenTestCases) || obj.hiddenTestCases.length === 0) {
    problems.push("hiddenTestCases must be a non-empty array");
  } else {
    for (const tc of obj.hiddenTestCases) problems.push(...validateTestCase(tc, "hidden"));
  }
  return problems;
}
