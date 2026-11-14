import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";

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

describe("GET /api/health", () => {
  it("still returns {ok:true} with no database involvement, unchanged", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/health/ready", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 {ok:true, database:\"connected\"} when the database is reachable", async () => {
    const res = await fetch(`${baseUrl}/api/health/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, database: "connected" });
  });

  it("returns 503 {ok:false, database:\"unavailable\"} when the database check fails, without crashing or leaking the error", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma.administrator, "count").mockRejectedValueOnce(
      new Error("connection to mongodb+srv://realuser:realpass@cluster0.mongodb.net/fisa_demo failed")
    );

    const res = await fetch(`${baseUrl}/api/health/ready`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ ok: false, database: "unavailable" });

    // The raw error (which, in this test, deliberately contains a fake
    // connection string) must never reach the HTTP response or any log
    // line — only the generic, hardcoded message is allowed.
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain("mongodb+srv");
    expect(bodyText).not.toContain("realpass");
    for (const call of consoleErrorSpy.mock.calls) {
      const logged = call.map(String).join(" ");
      expect(logged).not.toContain("mongodb+srv");
      expect(logged).not.toContain("realpass");
    }

    // The server process is still up and serving other requests — a
    // database failure on this one route must never crash the app.
    const healthRes = await fetch(`${baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);
  });
});
