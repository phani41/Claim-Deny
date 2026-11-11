-- CreateTable
CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_name_key" ON "Organization"("name");
CREATE INDEX IF NOT EXISTS "Organization_type_active_idx" ON "Organization"("type", "active");

-- AlterTable User
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;

-- AlterTable Claim
ALTER TABLE "Claim" ADD COLUMN "policyNumber" TEXT;
ALTER TABLE "Claim" ADD COLUMN "diagnosisCode" TEXT;
ALTER TABLE "Claim" ADD COLUMN "procedureCode" TEXT;
ALTER TABLE "Claim" ADD COLUMN "treatmentDescription" TEXT;
ALTER TABLE "Claim" ADD COLUMN "hospitalOrganizationId" TEXT;
ALTER TABLE "Claim" ADD COLUMN "insuranceOrganizationId" TEXT;

-- AlterTable AppealLetter
ALTER TABLE "AppealLetter" ADD COLUMN "revisionNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateTable ClaimReview
CREATE TABLE IF NOT EXISTS "ClaimReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "denialCode" TEXT,
    "denialExplanation" TEXT,
    "reviewComments" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimReview_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClaimReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ClaimReview_claimId_createdAt_idx" ON "ClaimReview"("claimId", "createdAt");
CREATE INDEX IF NOT EXISTS "ClaimReview_reviewerId_createdAt_idx" ON "ClaimReview"("reviewerId", "createdAt");

-- CreateTable AppealReview
CREATE TABLE IF NOT EXISTS "AppealReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appealLetterId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reviewerComment" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppealReview_appealLetterId_fkey" FOREIGN KEY ("appealLetterId") REFERENCES "AppealLetter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AppealReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AppealReview_appealLetterId_createdAt_idx" ON "AppealReview"("appealLetterId", "createdAt");
CREATE INDEX IF NOT EXISTS "AppealReview_reviewerId_createdAt_idx" ON "AppealReview"("reviewerId", "createdAt");

