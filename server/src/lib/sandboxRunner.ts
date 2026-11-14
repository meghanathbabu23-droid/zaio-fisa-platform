import { spawn as nodeSpawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { PracticalTestKind } from "@prisma/client";

/** Narrow slice of child_process.spawn's return value that runInSandbox
 * actually uses — injectable so tests can simulate timeouts/errors/malformed
 * output without requiring Docker to be installed in every environment. */
export type SpawnFn = (
  command: string,
  args: string[],
  options: { shell: boolean }
) => {
  stdin: { write: (chunk: string) => void; end: () => void };
  stdout: { on: (event: "data", cb: (chunk: Buffer | string) => void) => void };
  stderr: { on: (event: "data", cb: (chunk: Buffer | string) => void) => void };
  on: (event: "error" | "close", cb: (arg?: unknown) => void) => void;
  kill: (signal?: string) => void;
};

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

export type SandboxMode = "sandbox" | "sandbox_timeout" | "sandbox_error";

export type SandboxReport = {
  ok: boolean;
  mode: SandboxMode;
  results: TestCaseResult[];
  earnedPoints: number;
  maxPoints: number;
  scorePercent: number;
};

const IMAGE_NAME = "fisa-practical-runner:latest";
const DEFAULT_TIMEOUT_MS = 10_000;
// A crafted/buggy submission's output is bounded here even though jsdom's
// own virtual console is never wired to the real stdout (so student
// console.log calls can't reach this today) — a cheap guard against that
// assumption ever quietly changing later.
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

// Every flag here is a fixed constant — no user-controlled value ever
// reaches this argv. The image name, resource limits, and all other flags
// are hardcoded; only the piped stdin JSON carries variable content, and
// that content is parsed (never shell-interpreted) inside the container.
// --cap-drop=ALL: the container only ever reads stdin/writes stdout, so it
// needs zero Linux capabilities (no raw sockets, no privileged syscalls).
function buildDockerArgs(containerName: string): string[] {
  return [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network=none",
    "--memory=256m",
    "--cpus=0.5",
    "--pids-limit=64",
    "--read-only",
    "--tmpfs",
    "/tmp:size=16m",
    "--security-opt=no-new-privileges",
    "--cap-drop=ALL",
    "-i",
    IMAGE_NAME,
  ];
}

function emptyReport(mode: SandboxMode): SandboxReport {
  return { ok: false, mode, results: [], earnedPoints: 0, maxPoints: 0, scorePercent: 0 };
}

/** Best-effort: asks the Docker daemon to kill the named container
 * directly. Killing the local `docker run` CLI process alone (child.kill())
 * stops the client, but the container it started keeps running under the
 * daemon independently — this is what actually stops it. Fire-and-forget:
 * any failure here is logged, never thrown, since the resource limits
 * (--memory/--cpus/--pids-limit) already bound the impact either way. */
function defaultDockerKill(containerName: string): void {
  execFile("docker", ["kill", containerName], (err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error("[sandboxRunner] docker kill cleanup failed (non-fatal):", err.message);
    }
  });
}

/**
 * Runs test cases inside the Docker-sandboxed practical-runner image.
 * Never throws — any spawn failure, non-zero exit, malformed stdout, or
 * timeout returns a safe structured sandbox_timeout/sandbox_error result.
 * Raw stderr/stdout from the container is only ever written to the
 * server's own diagnostic log, never returned to a caller or client.
 */
export function runInSandbox(
  files: WorkspaceFile[],
  testCases: TestCaseInput[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  spawnFn: SpawnFn = nodeSpawn as unknown as SpawnFn,
  dockerKill: (containerName: string) => void = defaultDockerKill
): Promise<SandboxReport> {
  return new Promise((resolve) => {
    const containerName = `fisa-runner-${randomUUID()}`;
    const child = spawnFn("docker", buildDockerArgs(containerName), { shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let outputExceeded = false;

    const finish = (report: SandboxReport) => {
      if (settled) return;
      settled = true;
      resolve(report);
    };

    const killContainer = (reason: string) => {
      // eslint-disable-next-line no-console
      console.error(`[sandboxRunner] ${reason}, killing container ${containerName}`);
      child.kill("SIGKILL"); // stops the local docker CLI client
      dockerKill(containerName); // actually stops the daemon-managed container
    };

    const timer = setTimeout(() => {
      killContainer("execution timed out");
      finish(emptyReport("sandbox_timeout"));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (outputExceeded) return;
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_BYTES) {
        outputExceeded = true;
        clearTimeout(timer);
        killContainer("output exceeded size limit");
        finish(emptyReport("sandbox_error"));
      }
    });
    child.stderr.on("data", (chunk) => {
      if (!outputExceeded) stderr += chunk;
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      // eslint-disable-next-line no-console
      console.error("[sandboxRunner] docker spawn error:", err instanceof Error ? err.message : err);
      finish(emptyReport("sandbox_error"));
    });

    child.on("close", () => {
      clearTimeout(timer);
      if (settled) return;
      try {
        const parsed = JSON.parse(stdout) as { results?: TestCaseResult[]; error?: string };
        if (parsed.error || !Array.isArray(parsed.results)) {
          if (stderr) {
            // eslint-disable-next-line no-console
            console.error("[sandboxRunner] container reported an error:", parsed.error ?? "unknown");
          }
          finish(emptyReport("sandbox_error"));
          return;
        }
        const earnedPoints = parsed.results.reduce((s, r) => s + r.earned, 0);
        const maxPoints = testCases.reduce((s, tc) => s + tc.points, 0) || 1;
        const scorePercent = (earnedPoints / maxPoints) * 100;
        finish({ ok: true, mode: "sandbox", results: parsed.results, earnedPoints, maxPoints, scorePercent });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[sandboxRunner] malformed container output:", e instanceof Error ? e.message : e);
        finish(emptyReport("sandbox_error"));
      }
    });

    try {
      child.stdin.write(JSON.stringify({ files, testCases }));
      child.stdin.end();
    } catch (e) {
      clearTimeout(timer);
      // eslint-disable-next-line no-console
      console.error("[sandboxRunner] failed writing to container stdin:", e instanceof Error ? e.message : e);
      finish(emptyReport("sandbox_error"));
    }
  });
}
