import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.resolve(__dirname, "prisma/test.db");

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    globalSetup: ["./test/globalSetup.ts"],
    testTimeout: 15000,
    // All test files share one SQLite file — run sequentially to avoid
    // write contention and keep in-memory rate-limit state deterministic.
    fileParallelism: false,
    env: {
      DATABASE_URL: `file:${testDbPath}`,
      OTP_DELIVERY_MODE: "mock",
      OTP_HASH_SECRET: "test-only-secret-do-not-use-in-production",
      DEFAULT_PHONE_REGION: "ZA",
      NODE_ENV: "test",
      ALLOWED_ORIGINS: "http://localhost:5173",
      ADMIN_WEB_ORIGIN: "http://localhost:5173",
      // All test files share one loopback IP and (by default) run
      // sequentially against the real /api/admin/login route across many
      // unrelated test cases — this raises the secondary per-IP limiter well
      // above what any single test file needs, while the per-account
      // lockout (the actual brute-force defense) keeps its real production
      // value and is exercised directly in adminAuth.test.ts.
      ADMIN_LOGIN_IP_LIMIT_MAX: "500",
      // Test suite default: open tester registration is off unless a test file
      // (openTestRegistration.test.ts) explicitly enables it for its own run.
      ENABLE_OPEN_TEST_REGISTRATION: "false",
    },
  },
});
