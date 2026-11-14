import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Focused integration tests for the OTP network calls in api.ts, against a
 * stubbed global fetch — unlike StudentLoginPage.test.tsx (which mocks the
 * whole ../api module and never exercises these functions' real bodies),
 * this verifies the actual request shape sent on the wire matches the
 * backend contract (POST /api/auth/otp/request {email}, POST
 * /api/auth/otp/verify {email,code}), and that apiUrl() — the one place
 * VITE_API_BASE_URL is applied — behaves correctly both unset (relative,
 * same-origin path, the production default) and set (prefixed).
 */

function mockFetchOnce(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("requestOtp / verifyOtp — request shape", () => {
  it("POSTs to the relative /api/auth/otp/request path with {email} when VITE_API_BASE_URL is unset", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      message: "If that email is registered, a verification code has been sent.",
      expiresAt: new Date().toISOString(),
      cooldownSeconds: 60,
    });
    const { requestOtp } = await import("./api");

    await requestOtp("email", "student@example.com");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/otp/request");
    expect(JSON.parse(init.body)).toEqual({ email: "student@example.com" });
  });

  it("POSTs to the relative /api/auth/otp/verify path with {email, code} when VITE_API_BASE_URL is unset", async () => {
    const fetchMock = mockFetchOnce({
      token: "a-real-session-token",
      student: { id: "s1", firstName: "A", lastName: "B", email: "student@example.com" },
    });
    const { verifyOtp } = await import("./api");

    await verifyOtp("email", "student@example.com", "123456");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/otp/verify");
    expect(JSON.parse(init.body)).toEqual({ email: "student@example.com", code: "123456" });
  });

  it("prefixes the request with VITE_API_BASE_URL when it's set (opt-in cross-origin mode)", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const fetchMock = mockFetchOnce({
      ok: true,
      message: "ok",
      expiresAt: new Date().toISOString(),
      cooldownSeconds: 60,
    });
    const { requestOtp } = await import("./api");

    await requestOtp("email", "student@example.com");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/api/auth/otp/request");
  });

  it("strips a trailing slash from VITE_API_BASE_URL so the path never doubles up", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test/");
    const fetchMock = mockFetchOnce({
      ok: true,
      message: "ok",
      expiresAt: new Date().toISOString(),
      cooldownSeconds: 60,
    });
    const { requestOtp } = await import("./api");

    await requestOtp("email", "student@example.com");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/api/auth/otp/request");
  });

  it("surfaces the server's exact error message on a non-ok response (e.g. rate limited)", async () => {
    mockFetchOnce({ error: "Too many requests. Please wait and try again." }, 429);
    const { requestOtp } = await import("./api");

    await expect(requestOtp("email", "student@example.com")).rejects.toThrow(
      "Too many requests. Please wait and try again."
    );
  });
});
