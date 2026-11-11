import "dotenv/config";
import { readdirSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbFilePath = path.resolve(__dirname, "../dev.db");

const adapter = new PrismaBetterSqlite3({ url: `file:${dbFilePath}` });
const prisma = new PrismaClient({ adapter });

async function cleanData() {
  console.log("Cleaning all transactional data from HLT-06 database...");

  // 1. Delete all transactional tables in dependency order
  const citations = await prisma.appealCitation.deleteMany({});
  console.log(`- Deleted ${citations.count} appeal citation(s)`);

  const appealReviews = await prisma.appealReview.deleteMany({});
  console.log(`- Deleted ${appealReviews.count} appeal review(s)`);

  const appealLetters = await prisma.appealLetter.deleteMany({});
  console.log(`- Deleted ${appealLetters.count} appeal letter(s)`);

  const evidences = await prisma.evidence.deleteMany({});
  console.log(`- Deleted ${evidences.count} evidence item(s)`);

  const documents = await prisma.document.deleteMany({});
  console.log(`- Deleted ${documents.count} document record(s)`);

  const claimReviews = await prisma.claimReview.deleteMany({});
  console.log(`- Deleted ${claimReviews.count} claim review(s)`);

  const denials = await prisma.denial.deleteMany({});
  console.log(`- Deleted ${denials.count} denial record(s)`);

  const claims = await prisma.claim.deleteMany({});
  console.log(`- Deleted ${claims.count} claim(s)`);

  const auditLogs = await prisma.auditLog.deleteMany({});
  console.log(`- Deleted ${auditLogs.count} audit log(s)`);

  // 2. Clean all uploaded document files from backend uploads directory
  const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(__dirname, "../uploads");
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  } else {
    const files = readdirSync(uploadsDir);
    let deletedFiles = 0;
    for (const file of files) {
      if (file === ".gitkeep") continue;
      const filePath = path.join(uploadsDir, file);
      try {
        unlinkSync(filePath);
        deletedFiles++;
      } catch (err) {
        console.warn(`Could not remove ${file}:`, err.message);
      }
    }
    console.log(`- Removed ${deletedFiles} file(s) from uploads directory: ${uploadsDir}`);
  }

  // Also clean root uploads if it exists
  const rootUploadsDir = path.resolve(__dirname, "../../uploads");
  if (existsSync(rootUploadsDir)) {
    const rootFiles = readdirSync(rootUploadsDir);
    for (const file of rootFiles) {
      if (file === ".gitkeep") continue;
      try {
        unlinkSync(path.join(rootUploadsDir, file));
      } catch (_) {}
    }
  }

  // 3. Verify clean state
  const remainingClaims = await prisma.claim.count();
  const remainingDenials = await prisma.denial.count();
  const remainingLetters = await prisma.appealLetter.count();
  const remainingDocuments = await prisma.document.count();

  console.log("\n--- Verification ---");
  console.log(`Claims in DB: ${remainingClaims}`);
  console.log(`Denials in DB: ${remainingDenials}`);
  console.log(`Appeal Letters in DB: ${remainingLetters}`);
  console.log(`Documents in DB: ${remainingDocuments}`);

  const usersCount = await prisma.user.count();
  const orgsCount = await prisma.organization.count();
  const denialReasonsCount = await prisma.denialReason.count();

  console.log(`\nBase configuration preserved:`);
  console.log(`- ${usersCount} users (ready to login: billing@demo.in / reviewer@demo.in, password: Demo@123)`);
  console.log(`- ${orgsCount} organizations (hospital & insurance company)`);
  console.log(`- ${denialReasonsCount} denial reason codes (AUTH-01, MED-02, etc.)`);
  console.log("\nDatabase is completely clean and ready for fresh data!");
}

cleanData()
  .catch((err) => {
    console.error("Clean data failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

