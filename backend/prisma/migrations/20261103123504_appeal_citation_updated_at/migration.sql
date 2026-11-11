-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppealCitation" (
    "appealLetterId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "excerpt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("appealLetterId", "evidenceId"),
    CONSTRAINT "AppealCitation_appealLetterId_fkey" FOREIGN KEY ("appealLetterId") REFERENCES "AppealLetter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AppealCitation_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AppealCitation" ("appealLetterId", "createdAt", "evidenceId", "excerpt") SELECT "appealLetterId", "createdAt", "evidenceId", "excerpt" FROM "AppealCitation";
DROP TABLE "AppealCitation";
ALTER TABLE "new_AppealCitation" RENAME TO "AppealCitation";
CREATE INDEX "AppealCitation_evidenceId_idx" ON "AppealCitation"("evidenceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
