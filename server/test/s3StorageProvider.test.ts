import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { S3StorageProvider } from "../src/lib/storage/s3StorageProvider.js";

const s3Mock = mockClient(S3Client);

const VALID_CONFIG = {
  bucket: "fisa-exam-assets-test",
  region: "us-east-1",
  accessKeyId: "AKIAFAKEFAKEFAKEFAKE",
  secretAccessKey: "super-secret-value-never-logged",
};

function fakePdf(): Buffer {
  return Buffer.from("%PDF-1.4\n%%fake minimal pdf for tests%%\n%%EOF");
}

beforeEach(() => {
  s3Mock.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("S3StorageProvider — construction / configuration validation", () => {
  it("throws immediately, naming every missing field, when required config is absent", () => {
    expect(() => new S3StorageProvider({ bucket: "", region: "", accessKeyId: "", secretAccessKey: "" })).toThrow(
      /missing required configuration: bucket, region, accessKeyId, secretAccessKey/
    );
  });

  it("throws when only some fields are missing", () => {
    expect(
      () => new S3StorageProvider({ ...VALID_CONFIG, secretAccessKey: "" })
    ).toThrow(/missing required configuration: secretAccessKey/);
  });

  it("throws on whitespace-only config values, not just empty strings", () => {
    expect(() => new S3StorageProvider({ ...VALID_CONFIG, bucket: "   " })).toThrow(
      /missing required configuration: bucket/
    );
  });

  it("constructs successfully with complete config, endpoint omitted", () => {
    expect(() => new S3StorageProvider(VALID_CONFIG)).not.toThrow();
  });

  it("constructs successfully with an optional endpoint for S3-compatible providers", () => {
    expect(() => new S3StorageProvider({ ...VALID_CONFIG, endpoint: "https://s3.example-compat.com" })).not.toThrow();
  });
});

describe("S3StorageProvider — successful operations", () => {
  const provider = new S3StorageProvider(VALID_CONFIG);

  it("save() sends a PutObjectCommand with the exact bucket, key and body", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const buffer = fakePdf();
    await provider.save("exam123/abc-brief.pdf", buffer);

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input.Bucket).toBe(VALID_CONFIG.bucket);
    expect(calls[0]!.args[0].input.Key).toBe("exam123/abc-brief.pdf");
    expect(calls[0]!.args[0].input.Body).toBe(buffer);
  });

  it("getStream() returns a Readable whose content matches what was stored", async () => {
    const content = fakePdf();
    s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from(content) as never });

    const stream = await provider.getStream("exam123/abc-brief.pdf");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(content)).toBe(true);

    const calls = s3Mock.commandCalls(GetObjectCommand);
    expect(calls[0]!.args[0].input.Key).toBe("exam123/abc-brief.pdf");
  });

  it("exists() returns true when HeadObject succeeds", async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    await expect(provider.exists("exam123/abc-brief.pdf")).resolves.toBe(true);
  });

  it("delete() sends a DeleteObjectCommand with the exact key", async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    await provider.delete("exam123/abc-brief.pdf");
    const calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(calls[0]!.args[0].input.Key).toBe("exam123/abc-brief.pdf");
  });
});

describe("S3StorageProvider — missing objects", () => {
  const provider = new S3StorageProvider(VALID_CONFIG);

  it("exists() returns false (not a thrown error) on a 404/NotFound", async () => {
    const notFound = new S3ServiceException({
      name: "NotFound",
      $fault: "client",
      $metadata: { httpStatusCode: 404 },
    });
    s3Mock.on(HeadObjectCommand).rejects(notFound);
    await expect(provider.exists("exam123/missing.pdf")).resolves.toBe(false);
  });

  it("delete() on a missing object does not throw — idempotent, matching LocalDiskStorageProvider's force-delete semantics", async () => {
    // S3's own DeleteObject is idempotent at the API level (no error for a
    // missing key), so the mock simply resolves — there is nothing extra
    // for this class to special-case.
    s3Mock.on(DeleteObjectCommand).resolves({});
    await expect(provider.delete("exam123/already-gone.pdf")).resolves.toBeUndefined();
  });

  it("exists() still throws for a genuine, non-404 failure — a real error is not swallowed, not masked as 'missing'", async () => {
    const forbidden = new S3ServiceException({
      name: "AccessDenied",
      $fault: "client",
      $metadata: { httpStatusCode: 403 },
    });
    s3Mock.on(HeadObjectCommand).rejects(forbidden);
    await expect(provider.exists("exam123/abc-brief.pdf")).rejects.toThrow();
  });

  it("getStream() on a missing object throws rather than hanging or crashing", async () => {
    const noSuchKey = new S3ServiceException({
      name: "NoSuchKey",
      $fault: "client",
      $metadata: { httpStatusCode: 404 },
    });
    s3Mock.on(GetObjectCommand).rejects(noSuchKey);
    await expect(provider.getStream("exam123/missing.pdf")).rejects.toThrow();
  });

  it("getStream() throws a clear, specific error when the SDK returns a 200 with no readable body", async () => {
    // An unexpected/malformed response shape — Body missing entirely —
    // must not crash on .pipe()/.on() downstream; it should fail loudly
    // and clearly right here instead.
    s3Mock.on(GetObjectCommand).resolves({ Body: undefined });
    await expect(provider.getStream("exam123/abc-brief.pdf")).rejects.toThrow(/non-stream body/);
  });
});

describe("S3StorageProvider — network failure and timeout", () => {
  const provider = new S3StorageProvider(VALID_CONFIG);

  it("propagates a network-level failure from save(), sanitized", async () => {
    s3Mock.on(PutObjectCommand).rejects(new Error("getaddrinfo ENOTFOUND s3.amazonaws.com"));
    await expect(provider.save("exam123/brief.pdf", fakePdf())).rejects.toThrow(/ENOTFOUND/);
  });

  it("times out save() rather than hanging indefinitely when the SDK call never resolves", async () => {
    const shortTimeoutProvider = new S3StorageProvider({ ...VALID_CONFIG, operationTimeoutMs: 50 });
    s3Mock.on(PutObjectCommand).callsFake(() => new Promise(() => {})); // never resolves
    await expect(shortTimeoutProvider.save("exam123/brief.pdf", fakePdf())).rejects.toThrow(/timed out after 50ms/);
  });

  it("actually aborts the in-flight request on timeout — not merely gives up waiting", async () => {
    // aws-sdk-client-mock's callsFake only forwards the command input, not
    // send()'s second (options) argument, so abortSignal can't be observed
    // through the mock itself — spying on AbortController.prototype.abort
    // instead directly proves controller.abort() (and therefore the signal
    // passed into client.send()) was actually invoked, not just that the
    // caller gave up waiting. This test would fail against an
    // implementation that only races a timeout without ever calling abort.
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const shortTimeoutProvider = new S3StorageProvider({ ...VALID_CONFIG, operationTimeoutMs: 50 });
    s3Mock.on(PutObjectCommand).callsFake(() => new Promise(() => {})); // never resolves on its own

    await expect(shortTimeoutProvider.save("exam123/brief.pdf", fakePdf())).rejects.toThrow(/timed out after 50ms/);

    expect(abortSpy).toHaveBeenCalled();
  });

  it("a late rejection from the aborted call, arriving after the timeout has already been reported, does not crash the process or surface a second, different error", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const shortTimeoutProvider = new S3StorageProvider({ ...VALID_CONFIG, operationTimeoutMs: 30 });
      let signalFromSdk: AbortSignal | undefined;
      const originalAbort = AbortController.prototype.abort;
      // Capture the real signal the implementation constructs, then react
      // to it asynchronously — simulating a real SDK handler whose
      // teardown (and resulting rejection) completes some time after
      // abort() fires, not synchronously within the same tick.
      const abortSpy = vi.spyOn(AbortController.prototype, "abort").mockImplementation(function (
        this: AbortController
      ) {
        signalFromSdk = this.signal;
        return originalAbort.call(this);
      });
      s3Mock.on(PutObjectCommand).callsFake(() => {
        return new Promise((_resolve, reject) => {
          const check = setInterval(() => {
            if (signalFromSdk?.aborted) {
              clearInterval(check);
              setTimeout(() => reject(new Error("simulated late SDK abort-rejection")), 20);
            }
          }, 5);
        });
      });

      let caught: Error | undefined;
      try {
        await shortTimeoutProvider.save("exam123/brief.pdf", fakePdf());
      } catch (err) {
        caught = err as Error;
      }
      // The caller sees exactly the timeout error, not the later one.
      expect(caught?.message).toMatch(/timed out after 30ms/);
      expect(abortSpy).toHaveBeenCalled();

      // Give the "loser" promise time to settle after the race already did.
      await new Promise((r) => setTimeout(r, 150));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toHaveLength(0);
  });
});

describe("S3StorageProvider — credential and path leakage", () => {
  it("never includes the secret access key or access key id in a thrown error's message or stack", async () => {
    const provider = new S3StorageProvider(VALID_CONFIG);
    s3Mock
      .on(PutObjectCommand)
      .rejects(new Error(`auth failed for key ${VALID_CONFIG.accessKeyId} secret ${VALID_CONFIG.secretAccessKey}`));

    let caught: Error | undefined;
    try {
      await provider.save("exam123/brief.pdf", fakePdf());
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).not.toContain(VALID_CONFIG.secretAccessKey);
    expect(caught!.message).not.toContain(VALID_CONFIG.accessKeyId);
    expect(caught!.message).toContain("<redacted>");
    if (caught!.stack) {
      expect(caught!.stack).not.toContain(VALID_CONFIG.secretAccessKey);
    }
  });
});

// A "database failure after a successful storage upload" scenario is
// deliberately NOT tested here. That scenario exercises uploadExamAsset's
// application-level orchestration (validate -> provider.save() -> Prisma
// write) and the PDF feature's data integrity guarantees — it is not
// behavior of the S3StorageProvider class itself, which has no concept of
// a database at all. This file is scoped to provider-level behavior only;
// the orchestration/integrity scenario is covered by the PDF feature's own
// suite (server/test/examAssetsPdfReplacementSafety.test.ts — see "a
// database failure on the new upload preserves the old PDF"), which
// exercises the same uploadExamAsset code path through the StorageProvider
// interface regardless of which concrete provider is behind it.
