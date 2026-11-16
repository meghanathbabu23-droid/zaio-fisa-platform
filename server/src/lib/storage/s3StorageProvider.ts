import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type { StorageProvider } from "./types.js";

/**
 * Per-call timeout — this codebase's established pattern for a spawned/
 * external operation that must not hang a request indefinitely (see
 * runDbPush's 90s setTimeout/SIGTERM in scripts/setupMongoSchema.ts).
 * Transient-failure retry is deliberately NOT reimplemented here — the AWS
 * SDK v3 client already retries transient errors itself (its default
 * "standard" retry mode); this timeout only bounds how long a single
 * attempt (including the SDK's own internal retries) is allowed to run
 * before this class gives up and surfaces a clear error.
 */
const DEFAULT_OPERATION_TIMEOUT_MS = 15000;

/**
 * Strips any value that could be the configured secret access key out of an
 * error's message before it is ever thrown further, logged, or allowed to
 * reach an HTTP response — same redaction discipline as
 * sanitizeErrorMessage() in scripts/migrateToMongo.ts, adapted to what this
 * class actually holds (an AWS secret key, not a credentialed URI). Also
 * strips the access key id, which is not secret on its own but still an
 * identifier this app has no reason to expose.
 */
function sanitizeS3Error(err: unknown, secrets: string[]): Error {
  const raw = err instanceof Error ? err.message : String(err);
  let message = raw;
  for (const secret of secrets) {
    if (!secret) continue;
    message = message.split(secret).join("<redacted>");
  }
  const sanitized = new Error(message);
  if (err instanceof Error && err.stack) {
    let stack = err.stack;
    for (const secret of secrets) {
      if (!secret) continue;
      stack = stack.split(secret).join("<redacted>");
    }
    sanitized.stack = stack;
  }
  return sanitized;
}

function isNotFound(err: unknown): boolean {
  if (err instanceof S3ServiceException) {
    const status = err.$metadata?.httpStatusCode;
    if (status === 404) return true;
    if (err.name === "NotFound" || err.name === "NoSuchKey") return true;
  }
  return false;
}

/**
 * Races the real operation against an explicit timeout rather than only
 * passing an AbortSignal and trusting the SDK to reject once it fires —
 * aborting the signal still tells the underlying client to give up (so a
 * real S3Client call actually stops doing network work), but this function
 * does not depend on that behavior to resolve: if `fn` never settles for
 * any reason, the explicit timer below still rejects on schedule.
 */
async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`S3 ${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Real S3 (and S3-compatible, via `endpoint`) implementation of
 * StorageProvider. Configuration is validated eagerly at construction —
 * a misconfigured deployment fails immediately and clearly, not on the
 * first request deep inside an SDK call. Every method redacts the
 * configured secret before any error can propagate to a log line or an
 * HTTP response.
 */
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly secrets: string[];
  private readonly timeoutMs: number;

  constructor(
    private readonly config: {
      bucket: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      endpoint?: string;
      /** Test-only override; production code never needs to set this. */
      operationTimeoutMs?: number;
    }
  ) {
    const missing = (["bucket", "region", "accessKeyId", "secretAccessKey"] as const).filter(
      (key) => !config[key] || config[key].trim() === ""
    );
    if (missing.length > 0) {
      throw new Error(
        `S3StorageProvider is missing required configuration: ${missing.join(", ")}. ` +
          "Set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY " +
          "(S3_ENDPOINT is optional, for S3-compatible non-AWS providers)."
      );
    }

    this.bucket = config.bucket;
    this.secrets = [config.secretAccessKey, config.accessKeyId];
    this.timeoutMs = config.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    });
  }

  async save(key: string, buffer: Buffer): Promise<void> {
    try {
      await withTimeout("save", this.timeoutMs, (signal) =>
        this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer }), { abortSignal: signal })
      );
    } catch (err) {
      throw sanitizeS3Error(err, this.secrets);
    }
  }

  async getStream(key: string): Promise<Readable> {
    try {
      const response = await withTimeout("getStream", this.timeoutMs, (signal) =>
        this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal })
      );
      const body = response.Body;
      if (!body || !(body instanceof Readable)) {
        throw new Error("S3 getObject returned a non-stream body (unexpected in the Node runtime)");
      }
      return body;
    } catch (err) {
      throw sanitizeS3Error(err, this.secrets);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await withTimeout("exists", this.timeoutMs, (signal) =>
        this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal })
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw sanitizeS3Error(err, this.secrets);
    }
  }

  /** Idempotent, matching LocalDiskStorageProvider's rm(..., { force: true })
   *  semantics — S3's DeleteObject is itself idempotent (no error on a
   *  missing key), so no special-casing is needed beyond error redaction. */
  async delete(key: string): Promise<void> {
    try {
      await withTimeout("delete", this.timeoutMs, (signal) =>
        this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal })
      );
    } catch (err) {
      throw sanitizeS3Error(err, this.secrets);
    }
  }
}
