/**
 * One-time first-administrator creation. Always creates a SUPER_ADMIN.
 * Refuses outright if ANY administrator already exists — re-bootstrapping
 * after that point is not supported by this script on purpose; use the
 * admin UI (as an existing SUPER_ADMIN) or direct, deliberate DB access
 * instead.
 *
 * Usage:
 *   npx tsx scripts/bootstrap-admin.ts --email you@zaio.io --name "Your Name"
 *
 * You will then be prompted for the password interactively — it is never a
 * `--password` CLI argument (that would be visible in shell history and, on
 * most systems, to any other process via `ps`/`/proc` while this runs). At
 * a real terminal the prompt is fully hidden (no echo, not even asterisks).
 * Does NOT invent an email, name, or password — nothing here is defaulted.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(__dirname, "../.env"));
} catch {
  // Fine if absent — env vars may already be set in the shell.
}

const { PrismaClient } = await import("@prisma/client");
const { hashPassword } = await import("../src/lib/adminPassword.js");
const { isStrongPassword } = await import("../src/lib/adminAuthConfig.js");

function usage(): string {
  return (
    'Usage: npx tsx scripts/bootstrap-admin.ts --email you@zaio.io --name "Your Name"\n' +
    "You will be prompted for the password interactively (hidden, with confirmation) " +
    "— it is never a command-line argument."
  );
}

function parseArgs(): { email?: string; name?: string; hasPasswordFlag: boolean } {
  const args: { email?: string; name?: string; hasPasswordFlag: boolean } = { hasPasswordFlag: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--email") args.email = argv[++i];
    else if (arg === "--name") args.name = argv[++i];
    else if (arg === "--password") {
      args.hasPasswordFlag = true;
      i++; // skip its value too, so it's not misparsed as --email/--name
    }
  }
  return args;
}

/**
 * Reads one line from stdin at a real interactive terminal, with local echo
 * suppressed entirely (no characters, not even asterisks — the same
 * approach `sudo` uses) so the password is never visible on screen.
 */
function readHiddenTtyLine(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let input = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\n" || ch === "\r") {
          finish();
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (ch === "\u0003") {
          // Ctrl-C
          finish();
          process.stdout.write("\n");
          reject(new Error("Aborted."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          input = input.slice(0, -1);
          continue;
        }
        input += ch;
      }
    };
    function finish() {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    }
    stdin.on("data", onData);
  });
}

async function promptNewPassword(): Promise<string> {
  // stdin is not a TTY when piped (e.g. this script's own automated test,
  // or another script driving this one) — there's no terminal to suppress
  // echo on, so it's just read as plain lines. Read via the interface's
  // async iterator (`for await`), not two sequential `question()` calls:
  // when the whole piped input arrives in one chunk (as execFileSync's
  // `input` option does), readline can emit both 'line' events back to
  // back before the second `question()` has re-attached its one-time
  // listener, silently losing the second line. Async iteration doesn't
  // have that race — it pulls one line at a time, in order.
  if (!process.stdin.isTTY) {
    process.stdout.write("Password for the new administrator: ");
    const rl = createInterface({ input: process.stdin, terminal: false });
    try {
      const lines: string[] = [];
      for await (const line of rl) {
        lines.push(line);
        if (lines.length === 1) process.stdout.write("Confirm password: ");
        if (lines.length === 2) break;
      }
      const [a, b] = lines;
      if (a !== b) {
        throw new Error("Passwords did not match — nothing was created.");
      }
      return a;
    } finally {
      rl.close();
    }
  }

  const a = await readHiddenTtyLine("Password for the new administrator: ");
  const b = await readHiddenTtyLine("Confirm password: ");
  if (a !== b) {
    throw new Error("Passwords did not match — nothing was created.");
  }
  return a;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const existingCount = await prisma.administrator.count();
    if (existingCount > 0) {
      console.error(
        `Refusing to bootstrap: ${existingCount} administrator account(s) already exist. ` +
          "This script only creates the very first one."
      );
      process.exitCode = 1;
      return;
    }

    const { email, name, hasPasswordFlag } = parseArgs();
    if (hasPasswordFlag) {
      console.error(
        "Refusing: --password is no longer accepted on the command line — it would be exposed in shell " +
          "history and to other processes via `ps`/`/proc` while this runs. Omit it; you'll be prompted " +
          `securely instead.\n\n${usage()}`
      );
      process.exitCode = 1;
      return;
    }
    if (!email || !name) {
      console.error(usage());
      process.exitCode = 1;
      return;
    }

    let password: string;
    try {
      password = await promptNewPassword();
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
      return;
    }

    const strength = isStrongPassword(password);
    if (!strength.ok) {
      console.error(`Refusing to bootstrap: ${strength.reason}`);
      process.exitCode = 1;
      return;
    }

    const passwordHash = await hashPassword(password);
    const admin = await prisma.administrator.create({
      data: {
        fullName: name,
        email: email.trim().toLowerCase(),
        passwordHash,
        role: "SUPER_ADMIN",
      },
      select: { id: true, fullName: true, email: true, role: true, createdAt: true },
    });

    console.log("First administrator created:");
    console.log(JSON.stringify(admin, null, 2));
    console.log(
      "\nThe password never appeared on screen, was never a command-line argument, and was not stored " +
        "anywhere by this script — only its hash, in the database."
    );
  } finally {
    await prisma.$disconnect();
  }
}

main();
