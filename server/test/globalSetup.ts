import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");
const testDbPath = path.resolve(serverRoot, "prisma/test.db");

/**
 * Runs once before the whole test run, in the main process (not a worker).
 * Creates a dedicated, disposable SQLite file for tests — never touches
 * prisma/dev.db. Removed again in the teardown function below.
 */
export default async function globalSetup() {
  if (existsSync(testDbPath)) rmSync(testDbPath);

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
    stdio: "inherit",
  });

  return async () => {
    if (existsSync(testDbPath)) rmSync(testDbPath);
  };
}
