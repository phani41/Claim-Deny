ALTER TABLE "AppealLetter" ADD COLUMN "generationKey" TEXT;

CREATE UNIQUE INDEX "AppealLetter_generationKey_key" ON "AppealLetter"("generationKey");
