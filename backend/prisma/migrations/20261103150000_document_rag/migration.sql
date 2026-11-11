-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "pageCount" INTEGER,
    "sectionNamesJson" TEXT,
    "processingError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN "documentId" TEXT REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Evidence" ADD COLUMN "content" TEXT;
ALTER TABLE "Evidence" ADD COLUMN "sourceReference" TEXT;
ALTER TABLE "Evidence" ADD COLUMN "pageNumber" INTEGER;
ALTER TABLE "Evidence" ADD COLUMN "sectionName" TEXT;
ALTER TABLE "AppealLetter" ADD COLUMN "grounded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppealLetter" ADD COLUMN "requiresCorrection" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");
CREATE INDEX "Document_claimId_status_createdAt_idx" ON "Document"("claimId", "status", "createdAt");
CREATE INDEX "Document_uploadedById_createdAt_idx" ON "Document"("uploadedById", "createdAt");
CREATE INDEX "Evidence_documentId_pageNumber_idx" ON "Evidence"("documentId", "pageNumber");
