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
      // Root cause of a previously-flaky/env-dependent test: @prisma/client
      // auto-loads server/.env as a side effect the first time it's
      // imported (dotenv-style — it only fills in vars not already set, it
      // never overrides ones that are). Any var not explicitly forced here
      // is therefore at the mercy of whichever test file happens to import
      // prisma.js first, which can leak a real, developer-machine-specific
      // .env value (e.g. a provider switched to gmail_smtp for a demo) into
      // otpConfig's/aiConfig's module-level singletons for the entire test
      // run. Forcing every provider-related var here, explicitly, closes
      // this whole class of import-order-dependent leakage — exactly the
      // same reasoning server/src/index.ts already documents for why it
      // calls process.loadEnvFile itself before anything else can.
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "",
      RESEND_FROM_EMAIL: "",
      SMTP_USER: "",
      SMTP_APP_PASSWORD: "",
      GEMINI_API_KEY: "",
      VOYAGE_API_KEY: "",
      OPENAI_API_KEY: "",
      AI_LLM_PROVIDER: "gemini",
      // Same reasoning as above, for the Phase 2 MongoDB cutover switch in
      // src/prisma.ts — if a developer's real .env ever sets this to
      // "mongodb" for a real deployment, the SQLite test suite must never
      // silently inherit it (it would fail prisma.ts's own URL/provider
      // cross-check immediately, loudly, rather than quietly running
      // against the wrong provider — but forcing it here means that check
      // never even gets exercised by accident during a normal test run).
      ACTIVE_DB_PROVIDER: "sqlite",
    },
  },
});
