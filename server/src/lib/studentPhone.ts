/**
 * Student.phone is the only optional+unique field anywhere in the schema
 * (confirmed in the Phase 4 SQLite audit, re-confirmed against
 * schema.mongodb.prisma in the Phase 8 cutover-readiness audit). On
 * MongoDB, a sparse unique index only excludes documents where the key is
 * truly ABSENT — a document with `phone` explicitly present as `null` is
 * still indexed, so a second null-phone student would collide on the
 * index. SQLite has no such distinction: an explicit NULL and "column
 * never written" are the same thing at the storage level.
 *
 * These helpers let server/src/routes/students.ts build a provider-correct
 * write payload for either backend from one call site. The MongoDB shapes
 * mirror server/scripts/migrateToMongo.ts's transformStudent()/
 * buildStudentUpdatePayload() exactly — same tested approach, same
 * `{ unset: true }` operator (confirmed present on the generated Mongo
 * client's NullableStringFieldUpdateOperationsInput type). Duplicated here
 * rather than imported from migrateToMongo.ts deliberately: that file is a
 * standalone operational script, not meant to be a runtime dependency of
 * application code.
 */

/** Safe for both backends unconditionally: omitting the key when there is
 *  no phone means "use the column/field's default" on create, which for
 *  an undefaulted optional column is the same end state as writing `null`
 *  explicitly — on SQLite as well as MongoDB. No provider branch needed
 *  here, and the omit form is what MongoDB's sparse index actually
 *  requires, so this one shape is correct everywhere. */
export function buildPhoneCreateField(phone: string | null): { phone: string } | Record<string, never> {
  return phone === null ? {} : { phone };
}

/** SQLite's update shape: a plain nullable scalar. Explicit `null` clears
 *  the column — this is, and remains, the live application's actual
 *  behavior today. */
export function buildSqlitePhoneUpdateField(phone: string | null): { phone: string | null } {
  return { phone };
}

/**
 * MongoDB's update shape: omitting the key from an `update()` call means
 * "don't touch this field," not "clear it" — Prisma only ever translates
 * an explicit `null` to `$set: { phone: null }`, which keeps the key
 * present (and therefore still indexed) rather than removing it. Clearing
 * an existing phone on MongoDB requires the explicit `{ unset: true }`
 * operator instead.
 *
 * Not wired into the live route yet — src/prisma.ts's active client is
 * still the SQLite-generated one (DB_PROVIDER is "sqlite" today), so this
 * branch cannot execute in production until the real cutover also swaps
 * which client server/src/prisma.ts exports. It exists, and is tested
 * against the real generated MongoDB client, so that switch needs no
 * further logic change here.
 */
export function buildMongoPhoneUpdateField(
  phone: string | null
): { phone: string } | { phone: { unset: true } } {
  return phone === null ? { phone: { unset: true } } : { phone };
}
