/*
  Warnings:

  - Added the required column `displayName` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "payerName" TEXT NOT NULL,
    "serviceDate" DATETIME NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Claim_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DenialReason" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DenialReasonEvidenceRule" (
    "denialReasonCode" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "guidance" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("denialReasonCode", "evidenceType"),
    CONSTRAINT "DenialReasonEvidenceRule_denialReasonCode_fkey" FOREIGN KEY ("denialReasonCode") REFERENCES "DenialReason" ("code") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Denial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "denialReasonCode" TEXT NOT NULL,
    "reasonText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "denialDate" DATETIME NOT NULL,
    "payerReference" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Denial_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Denial_denialReasonCode_fkey" FOREIGN KEY ("denialReasonCode") REFERENCES "DenialReason" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Evidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Evidence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppealLetter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppealLetter_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AppealLetter_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AppealLetter_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppealCitation" (
    "appealLetterId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "excerpt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("appealLetterId", "evidenceId"),
    CONSTRAINT "AppealCitation_appealLetterId_fkey" FOREIGN KEY ("appealLetterId") REFERENCES "AppealLetter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AppealCitation_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PROVIDER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "id", "passwordHash", "updatedAt") SELECT "createdAt", "email", "id", "passwordHash", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_idx" ON "User"("role");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Claim_ownerId_status_createdAt_idx" ON "Claim"("ownerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Claim_ownerId_serviceDate_idx" ON "Claim"("ownerId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_ownerId_claimNumber_key" ON "Claim"("ownerId", "claimNumber");

-- CreateIndex
CREATE INDEX "DenialReason_active_title_idx" ON "DenialReason"("active", "title");

-- CreateIndex
CREATE INDEX "DenialReasonEvidenceRule_evidenceType_required_idx" ON "DenialReasonEvidenceRule"("evidenceType", "required");

-- CreateIndex
CREATE INDEX "Denial_claimId_createdAt_idx" ON "Denial"("claimId", "createdAt");

-- CreateIndex
CREATE INDEX "Denial_denialReasonCode_status_idx" ON "Denial"("denialReasonCode", "status");

-- CreateIndex
CREATE INDEX "Evidence_claimId_type_createdAt_idx" ON "Evidence"("claimId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Evidence_createdById_createdAt_idx" ON "Evidence"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "AppealLetter_claimId_createdAt_idx" ON "AppealLetter"("claimId", "createdAt");

-- CreateIndex
CREATE INDEX "AppealLetter_reviewerId_status_idx" ON "AppealLetter"("reviewerId", "status");

-- CreateIndex
CREATE INDEX "AppealCitation_evidenceId_idx" ON "AppealCitation"("evidenceId");
