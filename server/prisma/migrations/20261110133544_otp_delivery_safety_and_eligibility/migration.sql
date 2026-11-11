-- CreateTable
CREATE TABLE "OtpDeliveryFailure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "correlationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OtpDeliveryFailure_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Cohort" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "programme" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "examDate" DATETIME NOT NULL,
    "zoomLink" TEXT NOT NULL,
    "realOtpEligible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Cohort" ("createdAt", "examDate", "id", "name", "programme", "startDate", "updatedAt", "zoomLink") SELECT "createdAt", "examDate", "id", "name", "programme", "startDate", "updatedAt", "zoomLink" FROM "Cohort";
DROP TABLE "Cohort";
ALTER TABLE "new_Cohort" RENAME TO "Cohort";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "OtpDeliveryFailure_correlationId_key" ON "OtpDeliveryFailure"("correlationId");

-- CreateIndex
CREATE INDEX "OtpDeliveryFailure_createdAt_idx" ON "OtpDeliveryFailure"("createdAt");
