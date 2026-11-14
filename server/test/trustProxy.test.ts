import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import { app } from "../src/app.js";
import { resetRateLimitStateForTests } from "../src/lib/rateLimit.js";
import { MockEmailProvider } from "../src/lib/providers/index.js";
import { createTestStudent } from "./helpers.js";

/**
 * Regression test for Render's trust-proxy misconfiguration. Render's edge
 * proxy adds X-Forwarded-For to every request, but Express's `trust proxy`
 * defaulted to false, so req.ip ignored it and every client behind Render's
 * edge shared one rate-limit bucket (and express-rate-limit logged a caught
 * ERR_ERL_UNEXPECTED_X_FORWARDED_FOR ValidationError — confirmed by reading
 * express-rate-limit's source that this is swallowed internally and never
 * rethrown, so it was never the cause of a 500 or of blocked OTP delivery;
 * that incident's real cause is tracked separately). This test pins
 * `trust proxy` to the correct value and confirms rate-limited routes,
 * including OTP request, keep working normally with that header present.
 */
let baseUrl: string;
let server: ReturnType<typeof app.listen>;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  resetRateLimitStateForTests();
});

describe("trust proxy configuration", () => {
  it("is set to exactly 1 (Render's single-hop proxy), not false or true", () => {
    expect(app.get("trust proxy")).toBe(1);
  });

  it("a rate-limited route does not 500 when a real proxy's X-Forwarded-For header is present", async () => {
    const res = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.7" },
      body: JSON.stringify({ email: "nonexistent@example.com", password: "whatever-not-real" }),
    });
    expect(res.status).toBe(401);
  });

  it("the OTP request route succeeds when an X-Forwarded-For header is present", async () => {
    const student = await createTestStudent();
    const res = await fetch(`${baseUrl}/api/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.7" },
      body: JSON.stringify({ email: student.email }),
    });
    expect(res.status).toBe(200);
    expect(MockEmailProvider.sent.has(student.email)).toBe(true);
  });
});
