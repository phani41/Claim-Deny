-- AlterTable
ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN "patientName" TEXT;
ALTER TABLE "Claim" ADD COLUMN "hospitalName" TEXT;

-- AlterTable
ALTER TABLE "AppealLetter" ADD COLUMN "reviewerComment" TEXT;
ALTER TABLE "AppealLetter" ADD COLUMN "submittedAt" DATETIME;

