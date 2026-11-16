import { describe, it, expect, afterEach } from "vitest";
import { resolveStorageMode } from "../src/lib/storage/resolveStorageMode.js";

const ORIGINAL_STORAGE_PROVIDER = process.env.STORAGE_PROVIDER;

afterEach(() => {
  if (ORIGINAL_STORAGE_PROVIDER === undefined) delete process.env.STORAGE_PROVIDER;
  else process.env.STORAGE_PROVIDER = ORIGINAL_STORAGE_PROVIDER;
});

describe("resolveStorageMode — the shared STORAGE_PROVIDER switch", () => {
  it("defaults to local when unset, preserving the existing default", () => {
    delete process.env.STORAGE_PROVIDER;
    expect(resolveStorageMode()).toBe("local");
  });

  it("explicitly accepts local", () => {
    process.env.STORAGE_PROVIDER = "local";
    expect(resolveStorageMode()).toBe("local");
  });

  it("explicitly accepts s3", () => {
    process.env.STORAGE_PROVIDER = "s3";
    expect(resolveStorageMode()).toBe("s3");
  });

  it("refuses to silently fall back to local for an invalid value", () => {
    process.env.STORAGE_PROVIDER = "s4";
    expect(() => resolveStorageMode()).toThrow(/Invalid STORAGE_PROVIDER value: "s4"/);
  });

  it("refuses an empty-string value rather than treating it as unset", () => {
    process.env.STORAGE_PROVIDER = "";
    expect(() => resolveStorageMode()).toThrow(/Invalid STORAGE_PROVIDER value/);
  });

  it("the error message never contains any credential or secret value", () => {
    process.env.STORAGE_PROVIDER = "s3-prod-bucket-with-a-typo";
    process.env.S3_SECRET_ACCESS_KEY = "super-secret-value-should-never-appear";
    try {
      resolveStorageMode();
      throw new Error("expected resolveStorageMode to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain("super-secret-value-should-never-appear");
    } finally {
      delete process.env.S3_SECRET_ACCESS_KEY;
    }
  });
});
