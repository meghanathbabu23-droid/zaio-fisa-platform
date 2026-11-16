import { describe, expect, it } from "vitest";
import { PracticalTestKind } from "@prisma/client";
import { runInSandbox, type SpawnFn } from "../src/lib/sandboxRunner.js";

/**
 * A fake "container" that immediately closes with a canned stdout payload —
 * shaped exactly like the real fisa-practical-runner image's output
 * (results keyed by testCaseId only, no questionId, since the container
 * has no notion of questions). This is the documented, intended way to
 * test runInSandbox without Docker installed (see its SpawnFn doc comment).
 */
function fakeSpawn(stdoutPayload: unknown): SpawnFn {
  return () => {
    const stdoutHandlers: ((chunk: Buffer | string) => void)[] = [];
    const closeHandlers: (() => void)[] = [];
    queueMicrotask(() => {
      for (const h of stdoutHandlers) h(JSON.stringify(stdoutPayload));
      for (const h of closeHandlers) h();
    });
    return {
      stdin: { write: () => {}, end: () => {} },
      stdout: { on: (event, cb) => { if (event === "data") stdoutHandlers.push(cb); } },
      stderr: { on: () => {} },
      on: (event, cb) => { if (event === "close") closeHandlers.push(() => cb()); },
      kill: () => {},
    };
  };
}

describe("runInSandbox — questionId enrichment", () => {
  it("attaches each result's questionId by matching testCaseId against the input test cases, independent of the container's output", async () => {
    const report = await runInSandbox(
      [{ filename: "index.html", content: "<h1>Hi</h1>" }],
      [
        { id: "tc-1", label: "Has h1", kind: PracticalTestKind.HTML_SELECTOR, targetFile: null, expression: "h1", points: 1, questionId: "q-1" },
        { id: "tc-2", label: "Has footer", kind: PracticalTestKind.HTML_SELECTOR, targetFile: null, expression: "footer", points: 1, questionId: "q-1" },
        { id: "tc-3", label: "Ungrouped check", kind: PracticalTestKind.HTML_SELECTOR, targetFile: null, expression: "p", points: 1, questionId: null },
      ],
      1000,
      fakeSpawn({
        results: [
          { testCaseId: "tc-1", label: "Has h1", kind: "HTML_SELECTOR", points: 1, earned: 1, passed: true, detail: "ok" },
          { testCaseId: "tc-2", label: "Has footer", kind: "HTML_SELECTOR", points: 1, earned: 0, passed: false, detail: "missing" },
          { testCaseId: "tc-3", label: "Ungrouped check", kind: "HTML_SELECTOR", points: 1, earned: 1, passed: true, detail: "ok" },
        ],
      })
    );

    expect(report.mode).toBe("sandbox");
    const byId = new Map(report.results.map((r) => [r.testCaseId, r]));
    expect(byId.get("tc-1")?.questionId).toBe("q-1");
    expect(byId.get("tc-2")?.questionId).toBe("q-1");
    expect(byId.get("tc-3")?.questionId).toBeNull();
  });

  it("defaults to null when a test case input omits questionId entirely", async () => {
    const report = await runInSandbox(
      [{ filename: "index.html", content: "<h1>Hi</h1>" }],
      [{ id: "tc-1", label: "Has h1", kind: PracticalTestKind.HTML_SELECTOR, targetFile: null, expression: "h1", points: 1 }],
      1000,
      fakeSpawn({
        results: [{ testCaseId: "tc-1", label: "Has h1", kind: "HTML_SELECTOR", points: 1, earned: 1, passed: true, detail: "ok" }],
      })
    );
    expect(report.results[0]?.questionId).toBeNull();
  });
});
