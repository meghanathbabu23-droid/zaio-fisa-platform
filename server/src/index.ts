import path from "node:path";
import { fileURLToPath } from "node:url";

// Load server/.env explicitly and first, before anything else (including
// otpConfig.ts) reads process.env. Previously this "worked" only as a side
// effect of Prisma Client's own .env loading happening to run first — which
// broke the moment app.ts (and therefore prisma.ts) started being imported
// dynamically, after the otpConfig/boot-check module had already read
// process.env with nothing in it yet.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(__dirname, "../.env"));
} catch {
  // No .env file — fine in deployments where the platform injects env vars
  // directly (e.g. most production hosts). Only matters here for local dev.
}

const { assertOtpConfigSafeToBoot } = await import("./lib/otpConfig.js");
const { assertCorsConfigSafeToBoot } = await import("./lib/corsConfig.js");
const { assertOpenTestRegistrationSafeToBoot } = await import("./lib/openTestRegistrationConfig.js");
assertOtpConfigSafeToBoot();
assertCorsConfigSafeToBoot();
assertOpenTestRegistrationSafeToBoot();

const { app } = await import("./app.js");
const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
