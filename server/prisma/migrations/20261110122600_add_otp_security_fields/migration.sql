-- AlterTable
ALTER TABLE "Student" ADD COLUMN "emailVerifiedAt" DATETIME;
ALTER TABLE "Student" ADD COLUMN "phoneVerifiedAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OtpToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OtpToken_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OtpToken" ("codeHash", "consumedAt", "createdAt", "expiresAt", "id", "studentId") SELECT "codeHash", "consumedAt", "createdAt", "expiresAt", "id", "studentId" FROM "OtpToken";
DROP TABLE "OtpToken";
ALTER TABLE "new_OtpToken" RENAME TO "OtpToken";
CREATE INDEX "OtpToken_studentId_consumedAt_expiresAt_idx" ON "OtpToken"("studentId", "consumedAt", "expiresAt");
CREATE INDEX "OtpToken_studentId_channel_createdAt_idx" ON "OtpToken"("studentId", "channel", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
