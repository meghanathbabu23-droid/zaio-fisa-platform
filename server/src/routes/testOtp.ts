import { Router } from "express";
import { otpConfig } from "../lib/otpConfig.js";
import { MockEmailProvider, MockSmsProvider } from "../lib/providers/index.js";

/**
 * Test-only introspection endpoint. Lets a developer doing local manual
 * testing, `demo-smoke.mjs`, and automated tests read back a code the mock
 * provider "sent", without the main OTP API ever including it in a
 * response. Mounted by app.ts only when OTP_DELIVERY_MODE=mock, and the
 * boot-time check in otpConfig.ts refuses to start at all with mock mode in
 * production — so this route is structurally absent from a production
 * deployment via that path alone. The handler below adds a second,
 * independent check on NODE_ENV so this endpoint's own safety doesn't rest
 * entirely on that separate boot assertion never being weakened later.
 * NODE_ENV=test is intentionally still allowed — this project's own
 * automated test suite (httpAuth.test.ts, otp.test.ts, demo-smoke.mjs under
 * a dev server) calls this exact endpoint; "not production" is the actual
 * safety property that matters, not "development only" in the strict sense.
 */
export const testOtpRouter = Router();

testOtpRouter.get("/last-otp", (req, res) => {
  if (otpConfig.deliveryMode !== "mock" || process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const channel = typeof req.query.channel === "string" ? req.query.channel.toUpperCase() : "";
  const value = typeof req.query.value === "string" ? req.query.value : "";
  const captured =
    channel === "SMS" ? MockSmsProvider.sent.get(value) : MockEmailProvider.sent.get(value);
  if (!captured) {
    res.status(404).json({ error: "No mock OTP captured for that identifier" });
    return;
  }
  res.json({ code: captured.code, expiresAt: captured.expiresAt.toISOString() });
});
