/**
 * Single source of truth for STORAGE_PROVIDER validation, shared by both
 * storage/index.ts (recordings) and examAssetStorage.ts (exam assets) so
 * the two can never silently drift apart on what counts as a valid value.
 *
 * Unset -> "local" (preserves the existing default). Anything other than
 * exactly "local" or "s3" is a configuration mistake, not something to
 * silently fall back from — surfacing it immediately and clearly is safer
 * than treating a typo'd STORAGE_PROVIDER value as "local" and only
 * noticing later that uploads aren't durable.
 */
export function resolveStorageMode(): "local" | "s3" {
  const raw = process.env.STORAGE_PROVIDER;
  if (raw === undefined || raw === "local") return "local";
  if (raw === "s3") return "s3";
  throw new Error(
    `Invalid STORAGE_PROVIDER value: "${raw}". Expected "local" or "s3" (or leave it unset to default to "local").`
  );
}
