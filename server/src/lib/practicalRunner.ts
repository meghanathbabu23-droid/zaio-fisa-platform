import { PracticalTestKind } from "@prisma/client";
import { JSDOM } from "jsdom";

export type WorkspaceFile = { filename: string; content: string };

export type TestCaseInput = {
  id: string;
  label: string;
  kind: PracticalTestKind;
  targetFile: string | null;
  expression: string;
  points: number;
};

export type TestCaseResult = {
  testCaseId: string;
  label: string;
  kind: PracticalTestKind;
  points: number;
  earned: number;
  passed: boolean;
  detail: string;
};

export type AssessmentReport = {
  results: TestCaseResult[];
  earnedPoints: number;
  maxPoints: number;
  scorePercent: number;
};

function fileByName(files: WorkspaceFile[], name: string | null, ext: string): string {
  if (name) {
    return files.find((f) => f.filename === name)?.content ?? "";
  }
  const match = files.find((f) => f.filename.endsWith(ext));
  return match?.content ?? "";
}

function runOne(files: WorkspaceFile[], tc: TestCaseInput): TestCaseResult {
  const base = {
    testCaseId: tc.id,
    label: tc.label,
    kind: tc.kind,
    points: tc.points,
    earned: 0,
    passed: false,
    detail: "",
  };

  try {
    switch (tc.kind) {
      case PracticalTestKind.HTML_CONTAINS: {
        const html = fileByName(files, tc.targetFile, ".html");
        const ok = html.includes(tc.expression);
        return {
          ...base,
          passed: ok,
          earned: ok ? tc.points : 0,
          detail: ok ? "Required content found in HTML." : "Required content not found in HTML.",
        };
      }
      case PracticalTestKind.CSS_CONTAINS: {
        const css = fileByName(files, tc.targetFile, ".css");
        const ok = css.includes(tc.expression);
        return {
          ...base,
          passed: ok,
          earned: ok ? tc.points : 0,
          detail: ok ? "Required rule or value found in CSS." : "Required rule or value not found in CSS.",
        };
      }
      case PracticalTestKind.JS_CONTAINS: {
        const js = fileByName(files, tc.targetFile, ".js");
        const ok = js.includes(tc.expression);
        return {
          ...base,
          passed: ok,
          earned: ok ? tc.points : 0,
          detail: ok ? "Required code fragment found in JavaScript." : "Required code fragment not found in JavaScript.",
        };
      }
      case PracticalTestKind.HTML_SELECTOR: {
        const html = fileByName(files, tc.targetFile, ".html");
        const dom = new JSDOM(html);
        const el = dom.window.document.querySelector(tc.expression);
        const ok = el != null;
        return {
          ...base,
          passed: ok,
          earned: ok ? tc.points : 0,
          detail: ok
            ? `Selector "${tc.expression}" matched an element.`
            : `Selector "${tc.expression}" did not match.`,
        };
      }
      case PracticalTestKind.FILE_REGEX: {
        const file = tc.targetFile
          ? files.find((f) => f.filename === tc.targetFile)
          : files.find((f) => /\.(html|css|js)$/.test(f.filename));
        const content = file?.content ?? "";
        const re = new RegExp(tc.expression, "m");
        const ok = re.test(content);
        return {
          ...base,
          passed: ok,
          earned: ok ? tc.points : 0,
          detail: ok ? "Pattern matched." : `Pattern /${tc.expression}/ did not match.`,
        };
      }
      default:
        return { ...base, detail: "Unknown test kind." };
    }
  } catch (e) {
    return {
      ...base,
      detail: e instanceof Error ? e.message : "Test execution error",
    };
  }
}

export function runPracticalTests(
  files: WorkspaceFile[],
  testCases: TestCaseInput[]
): AssessmentReport {
  const results = testCases.map((tc) => runOne(files, tc));
  const earnedPoints = results.reduce((s, r) => s + r.earned, 0);
  const maxPoints = testCases.reduce((s, tc) => s + tc.points, 0) || 1;
  const scorePercent = (earnedPoints / maxPoints) * 100;
  return { results, earnedPoints, maxPoints, scorePercent };
}
