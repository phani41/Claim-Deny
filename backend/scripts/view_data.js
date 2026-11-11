import { prisma } from "../src/db/prisma.js";

async function viewData() {
  const arg = process.argv[2] ? process.argv[2].toLowerCase() : "all";

  try {
    if (arg === "all" || arg === "claims" || arg === "claim") {
      const claims = await prisma.claim.findMany({
        select: {
          id: true,
          claimNumber: true,
          patientName: true,
          diagnosisCode: true,
          procedureCode: true,
          amount: true,
          currency: true,
          status: true,
          insuranceOrganizationId: true,
          updatedAt: true
        },
        orderBy: { updatedAt: "desc" }
      });
      console.log(`\n📋 CLAIMS (${claims.length} total):`);
      if (claims.length === 0) console.log("   (No claims found)");
      else console.table(claims.map(c => ({
        "Claim #": c.claimNumber,
        "Patient": c.patientName,
        "ICD Code": c.diagnosisCode,
        "Procedure": c.procedureCode,
        "Amount": `${c.currency} ${c.amount}`,
        "Status": c.status,
        "Payer Org": c.insuranceOrganizationId
      })));
    }

    if (arg === "all" || arg === "denials" || arg === "denial") {
      const denials = await prisma.denial.findMany({
        include: {
          claim: { select: { claimNumber: true, patientName: true } }
        },
        orderBy: { createdAt: "desc" }
      });
      console.log(`\n🚫 DENIAL RECORDS (${denials.length} total):`);
      if (denials.length === 0) console.log("   (No active denials)");
      else console.table(denials.map(d => ({
        "Claim #": d.claim?.claimNumber,
        "Patient": d.claim?.patientName,
        "Denial Code": d.denialReasonCode,
        "Reason": (d.reasonText || "").substring(0, 45) + "...",
        "Date": d.denialDate ? d.denialDate.toISOString().split("T")[0] : ""
      })));
    }

    if (arg === "all" || arg === "letters" || arg === "letter" || arg === "appeals") {
      const letters = await prisma.appealLetter.findMany({
        include: {
          claim: { select: { claimNumber: true } }
        },
        orderBy: { updatedAt: "desc" }
      });
      console.log(`\n✉️  APPEAL LETTERS (${letters.length} total):`);
      if (letters.length === 0) console.log("   (No appeal letters generated yet)");
      else console.table(letters.map(l => ({
        "Claim #": l.claim?.claimNumber,
        "Status": l.status,
        "Confidence": l.confidenceScore,
        "Updated": l.updatedAt ? l.updatedAt.toISOString().split("T")[0] : ""
      })));
    }

    if (arg === "all" || arg === "reviews" || arg === "review") {
      const reviews = await prisma.claimReview.findMany({
        include: {
          claim: { select: { claimNumber: true, patientName: true } }
        },
        orderBy: { createdAt: "desc" }
      });
      console.log(`\n⚖️  CLAIM REVIEWS (${reviews.length} total):`);
      if (reviews.length === 0) console.log("   (No reviews logged)");
      else console.table(reviews.map(r => ({
        "Claim #": r.claim?.claimNumber,
        "Patient": r.claim?.patientName,
        "Decision": r.decision,
        "Denial Code": r.denialCode || "-",
        "Comments": (r.reviewComments || "").substring(0, 35) + "..."
      })));
    }

    if (arg === "all" || arg === "documents" || arg === "docs" || arg === "evidence") {
      const docs = await prisma.document.findMany({
        select: {
          id: true,
          originalName: true,
          type: true,
          status: true,
          claimId: true
        }
      });
      console.log(`\n📄 DOCUMENTS (${docs.length} total):`);
      if (docs.length === 0) console.log("   (No documents uploaded)");
      else console.table(docs.map(d => ({
        "File Name": d.originalName,
        "Type": d.type,
        "Status": d.status,
        "Claim ID": (d.claimId || "").substring(0, 12) + "..."
      })));

      const evidenceCount = await prisma.evidence.count();
      console.log(`\n🔍 EVIDENCE SEGMENTS: ${evidenceCount} verified items indexed.`);
    }

    if (arg === "users" || arg === "user") {
      const users = await prisma.user.findMany({
        select: {
          email: true,
          displayName: true,
          role: true,
          organizationId: true
        }
      });
      console.log(`\n👤 USERS (${users.length} total):`);
      console.table(users);
    }
  } catch (err) {
    console.error("Error reading database:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

viewData();
