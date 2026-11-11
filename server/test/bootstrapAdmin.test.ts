import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");

/**
 * The bootstrap script is a standalone CLI (it calls main() at import time
 * and reads real argv/stdin), so it's exercised as a real subprocess against
 * a disposable SQLite file — never the shared test.db used by the rest of
 * the suite, since this script's whole point is refusing to run a second
 * time once ANY administrator exists, and the shared db already has many by
 * the time this file runs.
 *
 * The password is never a CLI argument (it would leak into shell history
 * and `ps`) — it's fed via stdin instead, exactly as a human would type it
 * at the "Password:" / "Confirm password:" prompts. execFileSync's piped
 * stdin here is not a TTY, so the script reads it as plain lines rather
 * than trying to suppress terminal echo (there's no terminal to suppress).
 */
const tmpDbPaths: string[] = [];

function freshDbPath(): string {
  const p = path.resolve(serverRoot, `prisma/test-bootstrap-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tmpDbPaths.push(p);
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: `file:${p}` },
    stdio: "pipe",
  });
  return p;
}

function runBootstrap(
  dbPath: string,
  args: string[],
  stdin = ""
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("npx", ["tsx", "scripts/bootstrap-admin.ts", ...args], {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      input: stdin,
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, stdout: e.stdout, stderr: e.stderr };
  }
}

/** "Password:\n" + "Confirm password:\n" fed as two stdin lines. */
function passwordStdin(password: string, confirm = password): string {
  return `${password}\n${confirm}\n`;
}

afterEach(() => {
  for (const p of tmpDbPaths.splice(0)) {
    if (existsSync(p)) rmSync(p);
  }
});

describe("scripts/bootstrap-admin.ts", () => {
  it(
    "creates the first SUPER_ADMIN with a hashed (never plaintext) password, read from stdin, when no administrator exists",
    async () => {
      const dbPath = freshDbPath();
      const result = runBootstrap(
        dbPath,
        ["--email", "first.super@example.com", "--name", "First Super"],
        passwordStdin("Bootstrap-Strong1!")
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("First administrator created");
      expect(result.stdout).not.toContain("Bootstrap-Strong1!");

      const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
      try {
        const admins = await prisma.administrator.findMany();
        expect(admins.length).toBe(1);
        expect(admins[0].email).toBe("first.super@example.com");
        expect(admins[0].role).toBe("SUPER_ADMIN");
        expect(admins[0].passwordHash).not.toBe("Bootstrap-Strong1!");
        expect(admins[0].passwordHash.length).toBeGreaterThan(20);
      } finally {
        await prisma.$disconnect();
      }
    },
    20000
  );

  it(
    "refuses --password as a CLI argument, explaining why, and creates nothing",
    async () => {
      const dbPath = freshDbPath();
      const result = runBootstrap(dbPath, [
        "--email",
        "cli-password@example.com",
        "--name",
        "CLI Password",
        "--password",
        "Bootstrap-Strong1!",
      ]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Refusing");
      expect(result.stderr).toContain("shell");
      expect(result.stderr).not.toContain("Bootstrap-Strong1!");

      const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
      try {
        expect(await prisma.administrator.count()).toBe(0);
      } finally {
        await prisma.$disconnect();
      }
    },
    20000
  );

  it(
    "refuses when the password and its confirmation don't match, and creates nothing",
    async () => {
      const dbPath = freshDbPath();
      const result = runBootstrap(
        dbPath,
        ["--email", "mismatch@example.com", "--name", "Mismatch"],
        passwordStdin("Bootstrap-Strong1!", "Different-Strong1!")
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("did not match");

      const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
      try {
        expect(await prisma.administrator.count()).toBe(0);
      } finally {
        await prisma.$disconnect();
      }
    },
    20000
  );

  it(
    "refuses to run a second time once an administrator already exists, and does not create a duplicate",
    async () => {
      const dbPath = freshDbPath();
      const first = runBootstrap(
        dbPath,
        ["--email", "only.one@example.com", "--name", "Only One"],
        passwordStdin("Bootstrap-Strong1!")
      );
      expect(first.status).toBe(0);

      // No stdin needed — the existing-administrator check runs before any
      // password prompt, so the second attempt never reads stdin at all.
      const second = runBootstrap(dbPath, [
        "--email",
        "second.attempt@example.com",
        "--name",
        "Second Attempt",
      ]);
      expect(second.status).not.toBe(0);
      expect(second.stderr).toContain("Refusing to bootstrap");

      const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
      try {
        const admins = await prisma.administrator.findMany();
        expect(admins.length).toBe(1);
        expect(admins[0].email).toBe("only.one@example.com");
      } finally {
        await prisma.$disconnect();
      }
    },
    20000
  );

  it(
    "refuses with missing arguments and invents nothing",
    async () => {
      const dbPath = freshDbPath();
      const result = runBootstrap(dbPath, ["--email", "incomplete@example.com"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Usage:");

      const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
      try {
        expect(await prisma.administrator.count()).toBe(0);
      } finally {
        await prisma.$disconnect();
      }
    },
    20000
  );

  it(
    "refuses a weak password (typed at the prompt) and creates nothing",
    async () => {
      const dbPath = freshDbPath();
      const result = runBootstrap(
        dbPath,
        ["--email", "weak.pw@example.com", "--name", "Weak Pw"],
        passwordStdin("weak")
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Refusing to bootstrap");

      const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
      try {
        expect(await prisma.administrator.count()).toBe(0);
      } finally {
        await prisma.$disconnect();
      }
    },
    20000
  );
});
