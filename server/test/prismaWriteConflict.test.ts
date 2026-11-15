import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPrismaWriteConflictError, withPrismaWriteConflictRetry } from "../src/lib/prismaWriteConflict.js";

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("write conflict", {
    code: "P2034",
    clientVersion: "test",
  });
}

describe("isPrismaWriteConflictError", () => {
  it("detects Prisma P2034", () => {
    expect(isPrismaWriteConflictError(p2034())).toBe(true);
    expect(isPrismaWriteConflictError(new Error("nope"))).toBe(false);
  });
});

describe("withPrismaWriteConflictRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries transient P2034 and returns when the write eventually succeeds", async () => {
    let attempts = 0;
    const value = await withPrismaWriteConflictRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw p2034();
      return "saved";
    });
    expect(value).toBe("saved");
    expect(attempts).toBe(3);
  });

  it("rethrows non-P2034 errors immediately", async () => {
    let attempts = 0;
    await expect(
      withPrismaWriteConflictRetry(async () => {
        attempts += 1;
        throw new Error("fatal");
      })
    ).rejects.toThrow(/fatal/);
    expect(attempts).toBe(1);
  });
});