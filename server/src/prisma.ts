import type { PrismaClient as SqlitePrismaClient } from "@prisma/client";

/**
 * The actual cutover switch (see docs/MONGODB-CUTOVER.md). Explicit by
 * design — ACTIVE_DB_PROVIDER is the one source of truth for which
 * generated Prisma Client this process instantiates, never inferred solely
 * from DATABASE_URL's prefix (the DATABASE_URL check below is a loud
 * cross-check against misconfiguration, not the switch itself). Defaults
 * to "sqlite" when unset, so every existing local/dev/test workflow is
 * completely unaffected unless this is explicitly set.
 */
export type DbProvider = "sqlite" | "mongodb";

export function readActiveDbProvider(): DbProvider {
  const raw = process.env.ACTIVE_DB_PROVIDER ?? "sqlite";
  if (raw !== "sqlite" && raw !== "mongodb") {
    throw new Error(
      `Invalid ACTIVE_DB_PROVIDER "${raw}" — must be exactly "sqlite" or "mongodb". Refusing to guess.`
    );
  }
  return raw;
}

export function assertProviderMatchesDatabaseUrl(provider: DbProvider): void {
  const url = process.env.DATABASE_URL ?? "";
  const urlLooksMongo = url.startsWith("mongodb://") || url.startsWith("mongodb+srv://");
  if (provider === "mongodb" && !urlLooksMongo) {
    throw new Error(
      "ACTIVE_DB_PROVIDER=mongodb but DATABASE_URL does not look like a MongoDB connection string " +
        '("mongodb://" or "mongodb+srv://") — refusing to start with a provider/URL mismatch.'
    );
  }
  if (provider === "sqlite" && urlLooksMongo) {
    throw new Error(
      "ACTIVE_DB_PROVIDER=sqlite but DATABASE_URL looks like a MongoDB connection string — " +
        "refusing to start with a provider/URL mismatch."
    );
  }
}

/** Mirrors otpConfig.ts's/corsConfig.ts's own boot-time production guards —
 * a production deployment (Render) must never silently fall back to the
 * "sqlite" default, since there is no persistent local disk for a SQLite
 * file to live on there. Local dev/test are unaffected (NODE_ENV there is
 * never "production"). */
export function assertDbProviderSafeToBoot(provider: DbProvider): void {
  if (process.env.NODE_ENV === "production" && provider !== "mongodb") {
    throw new Error(
      "Refusing to start: NODE_ENV=production requires ACTIVE_DB_PROVIDER=mongodb — " +
        `got "${provider}". SQLite is not valid in a production/Render deployment.`
    );
  }
}

export const DB_PROVIDER: DbProvider = readActiveDbProvider();
assertProviderMatchesDatabaseUrl(DB_PROVIDER);
assertDbProviderSafeToBoot(DB_PROVIDER);

/**
 * Exactly one real Prisma Client instance exists in this process at any
 * time — never both simultaneously, which is the "fragile runtime mixture"
 * this deliberately avoids. `prisma` is typed as the SQLite-generated
 * client (the richer/canonical type every existing route already
 * type-checks against) regardless of which provider is actually active;
 * the MongoDB branch casts its real instance to that same type, which is
 * sound as long as schema.prisma and schema.mongodb.prisma stay in field-
 * level parity (verified as part of this cutover work — see
 * docs/MONGODB-CUTOVER.md). This means zero of the existing
 * `import { prisma } from "./prisma.js"` call sites across the app need
 * to change for either provider.
 *
 * The MongoDB client is constructed with an explicit `datasourceUrl`
 * override pointing at this process's own DATABASE_URL — never
 * MONGO_TEST_DATABASE_URL, which schema.mongodb.prisma's own datasource
 * block still uses for `prisma generate`/`db push`/the migration tooling
 * only (see docs/MONGODB-MIGRATION.md's Phase 6.5 section on why that
 * separation exists and must be preserved). DATABASE_URL is the one and
 * only variable that decides which real database the live application
 * talks to, for either provider.
 */
let prismaInstance: SqlitePrismaClient;
if (DB_PROVIDER === "mongodb") {
  const { PrismaClient: MongoPrismaClient } = await import("../prisma/generated/mongodb-client/index.js");
  prismaInstance = new MongoPrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
  }) as unknown as SqlitePrismaClient;
} else {
  const { PrismaClient: SqliteClient } = await import("@prisma/client");
  prismaInstance = new SqliteClient();
}

export const prisma = prismaInstance;
