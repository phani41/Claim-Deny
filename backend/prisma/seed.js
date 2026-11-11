import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_SYNTHETIC_SEED !== "true") {
  throw new Error("Synthetic seed is disabled in production.");
}
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./dev.db" });
const prisma = new PrismaClient({ adapter });
const passwordHash = (password) => bcrypt.hash(password, 10);
const date = (value) => new Date(value);

function createPdfBuffer(title, textContent) {
  const safeText = textContent.replace(/[()\\]/g, " ").replace(/\s+/g, " ");
  const contentStream = `BT\n/F1 12 Tf\n72 720 Td\n(${title}) Tj\n0 -24 Td\n(${safeText.slice(0, 160)}) Tj\n0 -18 Td\n(${safeText.slice(160, 320)}) Tj\n0 -18 Td\n(${safeText.slice(320, 480)}) Tj\nET`;
  const streamLength = Buffer.byteLength(contentStream);
  const pdfString = `%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>> endobj
4 0 obj <</Length ${streamLength}>> stream
${contentStream}
endstream endobj
5 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000224 00000 n 
0000000350 00000 n 
trailer <</Size 6 /Root 1 0 R>>
startxref
420
%%EOF
`;
  return Buffer.from(pdfString, "utf-8");
}

async function main() {
  const uploadsDir = path.resolve(process.env.UPLOADS_DIR || "./uploads");
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

  const isTest = process.env.NODE_ENV === "test";
  const defaultPassword = await passwordHash("Demo@123");

  // If running in development/normal mode, clear existing transactional records
  // to ensure exactly 3 records remain in the project.
  if (!isTest) {
    await prisma.appealCitation.deleteMany({});
    await prisma.appealReview.deleteMany({});
    await prisma.appealLetter.deleteMany({});
    await prisma.evidence.deleteMany({});
    await prisma.document.deleteMany({});
    await prisma.claimReview.deleteMany({});
    await prisma.denial.deleteMany({});
    await prisma.claim.deleteMany({});
  }

  // 1. Seed Organizations
  const hosp1 = await prisma.organization.upsert({
    where: { name: "Sri Venkateswara Multispeciality Hospital" },
    update: { type: "HOSPITAL", active: true },
    create: { id: "org-hosp-01", name: "Sri Venkateswara Multispeciality Hospital", type: "HOSPITAL", active: true }
  });

  const hosp2 = await prisma.organization.upsert({
    where: { name: "Aadhya Healthcare Institute" },
    update: { type: "HOSPITAL", active: true },
    create: { id: "org-hosp-02", name: "Aadhya Healthcare Institute", type: "HOSPITAL", active: true }
  });

  const ins1 = await prisma.organization.upsert({
    where: { name: "Bharat Health Assurance" },
    update: { type: "INSURANCE_COMPANY", active: true },
    create: { id: "org-ins-01", name: "Bharat Health Assurance", type: "INSURANCE_COMPANY", active: true }
  });

  const ins2 = await prisma.organization.upsert({
    where: { name: "Aarogya General Insurance" },
    update: { type: "INSURANCE_COMPANY", active: true },
    create: { id: "org-ins-02", name: "Aarogya General Insurance", type: "INSURANCE_COMPANY", active: true }
  });

  // 2. Seed Users (1 Biller, 1 Reviewer)
  const billing1 = await prisma.user.upsert({
    where: { email: "billing@demo.in" },
    update: { displayName: "Priya Sharma", role: "BILLING_SPECIALIST", active: true, organizationId: hosp1.id },
    create: { id: "seed-user-billing-1", email: "billing@demo.in", displayName: "Priya Sharma", role: "BILLING_SPECIALIST", organizationId: hosp1.id, passwordHash: defaultPassword, active: true }
  });

  const reviewer1 = await prisma.user.upsert({
    where: { email: "reviewer@demo.in" },
    update: { displayName: "Rahul Varma", role: "COMPLIANCE_REVIEWER", active: true, organizationId: ins1.id },
    create: { id: "seed-user-reviewer-1", email: "reviewer@demo.in", displayName: "Rahul Varma", role: "COMPLIANCE_REVIEWER", organizationId: ins1.id, passwordHash: defaultPassword, active: true }
  });

  // System Administrator (unconditionally seeded for admin dashboard & governance)
  const admin = await prisma.user.upsert({
    where: { email: "admin@demo.in" },
    update: { displayName: "Arjun Reddy", role: "ADMIN", active: true, organizationId: null },
    create: { id: "seed-user-admin", email: "admin@demo.in", displayName: "Arjun Reddy", role: "ADMIN", passwordHash: defaultPassword, active: true }
  });

  // Test-only administration users
  if (isTest) {
    const legacyProviderPassword = await passwordHash("DemoProvider1!");
    const legacyProvider2Password = await passwordHash("DemoProvider2!");
    const legacyReviewerPassword = await passwordHash("DemoReviewer1!");

    await prisma.user.upsert({
      where: { email: "billing.one@example.test" },
      update: { displayName: "Jordan Sample", role: "PROVIDER", active: true, organizationId: null },
      create: { id: "seed-provider-1", email: "billing.one@example.test", displayName: "Jordan Sample", role: "PROVIDER", organizationId: null, passwordHash: legacyProviderPassword, active: true }
    });
    await prisma.user.upsert({
      where: { email: "billing.two@example.test" },
      update: { displayName: "Riley Example", role: "PROVIDER", active: true, organizationId: null },
      create: { id: "seed-provider-2", email: "billing.two@example.test", displayName: "Riley Example", role: "PROVIDER", organizationId: null, passwordHash: legacyProvider2Password, active: true }
    });
    await prisma.user.upsert({
      where: { email: "reviewer.one@example.test" },
      update: { displayName: "Morgan Demo", role: "REVIEWER", active: true, organizationId: null },
      create: { id: "seed-reviewer-1", email: "reviewer.one@example.test", displayName: "Morgan Demo", role: "REVIEWER", organizationId: null, passwordHash: legacyReviewerPassword, active: true }
    });
  }

    // 3. Denial Reasons
  const legacyReasons = [
    {
      code: "CO-50",
      title: "Medical necessity not established",
      description: "Payer indicates the submitted documentation does not establish medical necessity under standard policy terms.",
      rules: [
        ["CLINICAL_NOTE", "Include the relevant clinician note."],
        ["IMAGING_REPORT", "Include the referenced imaging report."],
        ["TREATMENT_HISTORY", "Include prior treatment history when available."]
      ]
    },
    {
      code: "CO-16",
      title: "Missing clinical documentation",
      description: "Required claim or supporting clinical documentation was missing.",
      rules: [
        ["ORDER", "Include the signed order or referral."],
        ["CLINICAL_NOTE", "Include supporting documentation."]
      ]
    },
    {
      code: "CO-197",
      title: "Pre-authorization not available",
      description: "Payer records show a missing or mismatched pre-authorization.",
      rules: [
        ["AUTHORIZATION", "Include authorization confirmation."],
        ["REFERRAL", "Include referral documentation when applicable."]
      ]
    }
  ];

  const appReasons = [
    {
      code: "AUTH-01",
      title: "Missing Prior Authorization",
      description: "Service requires prior authorization before admission or treatment, but no authorization was requested or on file.",
      rules: [
        ["AUTHORIZATION", "Include pre-authorization request confirmation or emergency admission endorsement."],
        ["CLINICAL_NOTE", "Include emergency admission clinical summary."]
      ]
    },
    {
      code: "MED-01",
      title: "Medical Necessity Not Established",
      description: "Submitted clinical documentation does not establish medical necessity for the level of acute care or elective procedure billed.",
      rules: [
        ["CLINICAL_NOTE", "Include detailed attending consultant clinical progress notes and surgical justification."],
        ["IMAGING_REPORT", "Include radiologist-signed imaging reports confirming diagnosis."],
        ["TREATMENT_HISTORY", "Include documented record of failed prior conservative management."]
      ]
    },
    {
      code: "DOC-01",
      title: "Missing Clinical Documentation",
      description: "Required diagnostic test results, physician order sheets, or operative summaries are missing from the claim package.",
      rules: [
        ["ORDER", "Include signed physician admission and surgical order with clinical diagnosis."],
        ["CLINICAL_NOTE", "Include full hospital admission and daily clinical treatment notes."]
      ]
    },
    {
      code: "POLICY-01",
      title: "Policy Exclusion or Benefit Limit Exceeded",
      description: "The specified diagnosis or therapeutic procedure is not covered under active policy terms or exceeds sub-limit.",
      rules: [
        ["TREATMENT_HISTORY", "Include lifetime medical history proving non-pre-existing onset."]
      ]
    },
    {
      code: "TIMELY-01",
      title: "Exceeded Timely Filing Limit",
      description: "Claim was submitted beyond the mandated 30-day window following patient discharge without pre-approved extension.",
      rules: [
        ["CLINICAL_NOTE", "Include hospital discharge summary and filing delay justification."]
      ]
    },
    {
      code: "MED-NEC-01",
      title: "Medical Necessity Not Established",
      description: "Payer medical review determined submitted documentation does not establish medical necessity under standard policy terms.",
      rules: [
        ["CLINICAL_NOTE", "Include consultant progress notes and surgical justification."],
        ["IMAGING_REPORT", "Include imaging reports."],
        ["TREATMENT_HISTORY", "Include prior conservative treatment records."]
      ]
    },
    ...legacyReasons
  ];

  const denialReasonList = isTest ? legacyReasons : appReasons;

  for (const reason of denialReasonList) {
    await prisma.denialReason.upsert({
      where: { code: reason.code },
      update: { title: reason.title, description: reason.description, active: true },
      create: { code: reason.code, title: reason.title, description: reason.description }
    });
    for (const [evidenceType, guidance] of reason.rules) {
      await prisma.denialReasonEvidenceRule.upsert({
        where: { denialReasonCode_evidenceType: { denialReasonCode: reason.code, evidenceType } },
        update: { required: true, guidance },
        create: { denialReasonCode: reason.code, evidenceType, required: true, guidance }
      });
    }
  }

  // 4. Claims Seed Data
  // When isTest is true, seed legacy test harness claims
  const legacyClaimSpecs = [
    {
      id: "seed-claim-001",
      ownerId: "seed-provider-1",
      claimNumber: "SYN-2025-0001",
      patientName: "Synthetic Patient 1",
      hospitalName: "Synthetic Community Hospital",
      payerName: "Harbor Sample Plan",
      hospitalOrganizationId: null,
      insuranceOrganizationId: null,
      serviceDate: "2025-02-15",
      amount: "1450.50",
      currency: "USD",
      status: "DENIED"
    },
    {
      id: "seed-claim-002",
      ownerId: "seed-provider-1",
      claimNumber: "SYN-2025-0002",
      patientName: "Synthetic Patient 2",
      hospitalName: "Synthetic Community Hospital",
      payerName: "Harbor Sample Plan",
      hospitalOrganizationId: null,
      insuranceOrganizationId: null,
      serviceDate: "2025-03-03",
      amount: "620.00",
      currency: "USD",
      status: "DENIED"
    },
    {
      id: "seed-claim-003",
      ownerId: "seed-provider-2",
      claimNumber: "SYN-2025-0003",
      patientName: "Synthetic Patient 3",
      hospitalName: "Synthetic Metro Clinic",
      payerName: "Northstar Example Health",
      hospitalOrganizationId: null,
      insuranceOrganizationId: null,
      serviceDate: "2025-04-09",
      amount: "905.75",
      currency: "USD",
      status: "DENIED"
    }
  ];

  // EXACTLY 3 RECORDS for the project:
  // 1 Approved/Accepted, 1 Denied, 1 Needs Review
  const threeProjectClaims = [
    {
      id: "seed-claim-1001",
      ownerId: billing1.id,
      claimNumber: "CLM-1001",
      patientName: "Ramesh Kumar",
      hospitalName: hosp1.name,
      payerName: ins1.name,
      hospitalOrganizationId: hosp1.id,
      insuranceOrganizationId: ins1.id,
      policyNumber: "BHA-POL-2024-8841",
      diagnosisCode: "M17.11",
      procedureCode: "CPT-27447",
      treatmentDescription: "Total knee replacement surgery for severe osteoarthritis",
      serviceDate: "2025-01-15",
      amount: "85000.00",
      currency: "INR",
      status: "APPROVED" // Record 1: ACCEPTED / APPROVED
    },
    {
      id: "seed-claim-1002",
      ownerId: billing1.id,
      claimNumber: "CLM-1002",
      patientName: "Ananya Reddy",
      hospitalName: hosp1.name,
      payerName: ins1.name,
      hospitalOrganizationId: hosp1.id,
      insuranceOrganizationId: ins1.id,
      policyNumber: "BHA-POL-2025-1092",
      diagnosisCode: "K80.20",
      procedureCode: "CPT-47562",
      treatmentDescription: "Laparoscopic gallbladder removal surgery",
      serviceDate: "2025-02-10",
      amount: "125000.00",
      currency: "INR",
      status: "DENIED" // Record 2: DENIED
    },
    {
      id: "seed-claim-1003",
      ownerId: billing1.id,
      claimNumber: "CLM-1003",
      patientName: "Suresh Babu",
      hospitalName: hosp1.name,
      payerName: ins1.name,
      hospitalOrganizationId: hosp1.id,
      insuranceOrganizationId: ins1.id,
      policyNumber: "BHA-POL-2024-5519",
      diagnosisCode: "K35.80",
      procedureCode: "CPT-44970",
      treatmentDescription: "Emergency laparoscopic appendectomy surgery",
      serviceDate: "2025-02-20",
      amount: "45000.00",
      currency: "INR",
      status: "SUBMITTED" // Record 3: NEEDS REVIEW / AWAITING APPROVAL
    }
  ];

  const claimSpecs = isTest ? legacyClaimSpecs : threeProjectClaims;

  const claims = {};
  for (const spec of claimSpecs) {
    const { id, ...fields } = spec;
    claims[id] = await prisma.claim.upsert({
      where: { id },
      update: {
        ownerId: spec.ownerId,
        claimNumber: spec.claimNumber,
        patientName: fields.patientName,
        hospitalName: fields.hospitalName,
        payerName: fields.payerName,
        policyNumber: fields.policyNumber,
        diagnosisCode: fields.diagnosisCode,
        procedureCode: fields.procedureCode,
        treatmentDescription: fields.treatmentDescription,
        hospitalOrganizationId: fields.hospitalOrganizationId,
        insuranceOrganizationId: fields.insuranceOrganizationId,
        serviceDate: date(fields.serviceDate),
        amount: new Prisma.Decimal(fields.amount),
        currency: fields.currency,
        status: fields.status
      },
      create: {
        ...fields,
        id,
        ownerId: spec.ownerId,
        serviceDate: date(fields.serviceDate),
        amount: new Prisma.Decimal(fields.amount)
      }
    });
  }

  // 5. Denials & Claim Reviews for the 3 records
  if (!isTest) {
    // Record 1 (CLM-1001) is APPROVED
    await prisma.claimReview.upsert({
      where: { id: "seed-cr-1001" },
      update: {
        decision: "APPROVED",
        reviewComments: "Claim approved. Knee replacement surgery documentation, X-ray imaging, and pre-operative evaluation are complete."
      },
      create: {
        id: "seed-cr-1001",
        claimId: claims["seed-claim-1001"].id,
        reviewerId: reviewer1.id,
        decision: "APPROVED",
        reviewComments: "Claim approved. Knee replacement surgery documentation, X-ray imaging, and pre-operative evaluation are complete."
      }
    });

    // Record 2 (CLM-1002) is DENIED
    await prisma.denial.upsert({
      where: { id: "seed-denial-1002" },
      update: {
        claimId: claims["seed-claim-1002"].id,
        denialReasonCode: "AUTH-01",
        reasonText: "Claim denied: Missing prior insurance authorization before hospital admission for elective surgery.",
        denialDate: date("2025-02-14")
      },
      create: {
        id: "seed-denial-1002",
        claimId: claims["seed-claim-1002"].id,
        denialReasonCode: "AUTH-01",
        reasonText: "Claim denied: Missing prior insurance authorization before hospital admission for elective surgery.",
        denialDate: date("2025-02-14")
      }
    });

    await prisma.claimReview.upsert({
      where: { id: "seed-cr-1002" },
      update: {
        decision: "DENIED",
        denialCode: "AUTH-01",
        denialExplanation: "Elective gallbladder surgery requires prior insurance authorization before hospital admission, but none was on file.",
        reviewComments: "Claim denied due to missing pre-authorization. Hospital billing specialist may file an appeal with emergency admission records if applicable."
      },
      create: {
        id: "seed-cr-1002",
        claimId: claims["seed-claim-1002"].id,
        reviewerId: reviewer1.id,
        decision: "DENIED",
        denialCode: "AUTH-01",
        denialExplanation: "Elective gallbladder surgery requires prior insurance authorization before hospital admission, but none was on file.",
        reviewComments: "Claim denied due to missing pre-authorization. Hospital billing specialist may file an appeal with emergency admission records if applicable."
      }
    });

    // Record 3 (CLM-1003) is SUBMITTED (Needs Review / Pending Adjudication)
    // No final ClaimReview yet so it appears as pending adjudication in reviewer queues!

    // 6. Documents & Evidence Records for the 3 claims
    const documentSpecs = [
      {
        id: "seed-doc-1001-cn",
        claimId: claims["seed-claim-1001"].id,
        uploadedById: billing1.id,
        type: "CLINICAL_NOTE",
        originalName: "Clinical_Summary_Ramesh_Kumar.pdf",
        storageKey: "seed-doc-1001-cn.pdf",
        title: "Sri Venkateswara Multispeciality Hospital - Clinical Summary",
        text: "Patient Ramesh Kumar, 58/M, presented with severe grade-IV osteoarthritis of the right knee with persistent joint pain unresponsive to 9 months of conservative treatment. Total knee arthroplasty was performed with uneventful recovery.",
        summary: "Consultant orthopedic note confirms severe grade-IV knee osteoarthritis and successful knee replacement surgery.",
        sourceLabel: "Orthopedic Clinical Summary",
        pageNumber: 1,
        sectionName: "Clinical Findings"
      },
      {
        id: "seed-doc-1001-img",
        claimId: claims["seed-claim-1001"].id,
        uploadedById: billing1.id,
        type: "IMAGING_REPORT",
        originalName: "XRay_RightKnee_Ramesh_Kumar.pdf",
        storageKey: "seed-doc-1001-img.pdf",
        title: "Sri Venkateswara Multispeciality Hospital - Radiological Evaluation",
        text: "Standing bilateral knee radiograph reveals complete joint space obliteration in the medial tibiofemoral compartment of the right knee with prominent osteophytosis, subchondral sclerosis, and varus deformity consistent with severe Kellgren-Lawrence Grade 4 osteoarthritis.",
        summary: "Bilateral knee X-ray showing severe grade-4 osteoarthritis with complete medial joint space collapse.",
        sourceLabel: "Knee Radiography Report",
        pageNumber: 1,
        sectionName: "Radiological Evaluation"
      },
      {
        id: "seed-doc-1002-cn",
        claimId: claims["seed-claim-1002"].id,
        uploadedById: billing1.id,
        type: "CLINICAL_NOTE",
        originalName: "Operative_Report_Ananya_Reddy.pdf",
        storageKey: "seed-doc-1002-cn.pdf",
        title: "Sri Venkateswara Multispeciality Hospital - Operative Record",
        text: "Patient Ananya Reddy, 34/F, underwent laparoscopic cholecystectomy for symptomatic cholelithiasis with recurrent biliary colic. Laparoscopic visualization confirmed chronically inflamed gallbladder containing multiple calculi.",
        summary: "Operative record detailing successful laparoscopic cholecystectomy for acute cholelithiasis.",
        sourceLabel: "Surgical Operative Record",
        pageNumber: 1,
        sectionName: "Operative Summary"
      },
      {
        id: "seed-doc-1002-ord",
        claimId: claims["seed-claim-1002"].id,
        uploadedById: billing1.id,
        type: "ORDER",
        originalName: "Surgeon_Order_Ananya_Reddy.pdf",
        storageKey: "seed-doc-1002-ord.pdf",
        title: "Sri Venkateswara Multispeciality Hospital - Physician Admission Order",
        text: "Signed admitting order by Dr. Sneha Rao (General & Laparoscopic Surgeon): Patient Ananya Reddy admitted for elective laparoscopic cholecystectomy under general anesthesia following recurrent emergency department presentations with acute biliary colic.",
        summary: "Admitting physician order for laparoscopic cholecystectomy for recurrent biliary colic.",
        sourceLabel: "Surgeon Admission Order",
        pageNumber: 1,
        sectionName: "Admission Orders"
      },
      {
        id: "seed-doc-1003-auth",
        claimId: claims["seed-claim-1003"].id,
        uploadedById: billing1.id,
        type: "AUTHORIZATION",
        originalName: "Emergency_Admission_Auth_Suresh_Babu.pdf",
        storageKey: "seed-doc-1003-auth.pdf",
        title: "Sri Venkateswara Multispeciality Hospital - Emergency Admission Record",
        text: "Emergency admission notification: Patient Suresh Babu admitted via emergency department with acute appendicitis. Cashless desk notified Bharat Health Assurance at 02:45 AM within 4 hours of arrival; emergency appendectomy performed urgently.",
        summary: "Emergency admission record verifying cashless notification within 4 hours of hospital arrival for acute appendicitis.",
        sourceLabel: "Emergency Admission Notification",
        pageNumber: 1,
        sectionName: "Emergency Record"
      }
    ];

    const seededEvidences = {};
    for (const doc of documentSpecs) {
      const buffer = createPdfBuffer(doc.title, doc.text);
      const filePath = path.join(uploadsDir, doc.storageKey);
      writeFileSync(filePath, buffer);

      const docRow = await prisma.document.upsert({
        where: { storageKey: doc.storageKey },
        update: {
          originalName: doc.originalName,
          mimeType: "application/pdf",
          sizeBytes: buffer.length,
          status: "INDEXED",
          pageCount: 1,
          sectionNamesJson: JSON.stringify([doc.sectionName])
        },
        create: {
          id: doc.id,
          claimId: doc.claimId,
          uploadedById: doc.uploadedById,
          type: doc.type,
          originalName: doc.originalName,
          storageKey: doc.storageKey,
          mimeType: "application/pdf",
          sizeBytes: buffer.length,
          status: "INDEXED",
          pageCount: 1,
          sectionNamesJson: JSON.stringify([doc.sectionName])
        }
      });

      const eviId = `evi-${doc.id}`;
      const eviRow = await prisma.evidence.upsert({
        where: { id: eviId },
        update: {
          summary: doc.summary,
          content: doc.text,
          sourceLabel: doc.sourceLabel,
          pageNumber: doc.pageNumber,
          sectionName: doc.sectionName,
          sourceReference: `document:${docRow.id}#segment=p1`
        },
        create: {
          id: eviId,
          claimId: doc.claimId,
          createdById: doc.uploadedById,
          documentId: docRow.id,
          type: doc.type,
          sourceLabel: doc.sourceLabel,
          summary: doc.summary,
          content: doc.text,
          sourceReference: `document:${docRow.id}#segment=p1`,
          pageNumber: doc.pageNumber,
          sectionName: doc.sectionName,
          sourceDate: date("2025-01-20")
        }
      });
      seededEvidences[doc.id] = eviRow;
    }

    // 7. Appeal Letters for the claims
    // Record 1 (CLM-1001): APPROVED Appeal
    const letter1001 = await prisma.appealLetter.upsert({
      where: { id: "seed-letter-1001" },
      update: {
        subject: "Medical Necessity Appeal - Claim CLM-1001 - Ramesh Kumar",
        status: "APPROVED",
        reviewerId: reviewer1.id,
        reviewerComment: "Appeal approved. Surgical and clinical documentation satisfied all medical necessity criteria.",
        reviewedAt: date("2025-01-28T14:00:00Z"),
        submittedAt: date("2025-01-20T10:00:00Z"),
        content: `Bharat Health Assurance Grievance Cell\n\nSubject: Appeal for Claim CLM-1001\nPatient: Ramesh Kumar\nHospital: Sri Venkateswara Multispeciality Hospital\nPolicy Number: BHA-POL-2024-8841\n\nDear Appeals Committee,\n\nWe submit clinical documentation for patient Ramesh Kumar's total knee replacement surgery. The patient underwent 9 months of conservative management prior to surgical intervention.\n\nRespectfully,\nPriya Sharma\nBilling Specialist`,
        grounded: true
      },
      create: {
        id: "seed-letter-1001",
        claimId: claims["seed-claim-1001"].id,
        authorId: billing1.id,
        reviewerId: reviewer1.id,
        generationKey: "seed-gen-key-1001",
        subject: "Medical Necessity Appeal - Claim CLM-1001 - Ramesh Kumar",
        status: "APPROVED",
        reviewerComment: "Appeal approved. Surgical and clinical documentation satisfied all medical necessity criteria.",
        reviewedAt: date("2025-01-28T14:00:00Z"),
        submittedAt: date("2025-01-20T10:00:00Z"),
        content: `Bharat Health Assurance Grievance Cell\n\nSubject: Appeal for Claim CLM-1001\nPatient: Ramesh Kumar\nHospital: Sri Venkateswara Multispeciality Hospital\nPolicy Number: BHA-POL-2024-8841\n\nDear Appeals Committee,\n\nWe submit clinical documentation for patient Ramesh Kumar's total knee replacement surgery. The patient underwent 9 months of conservative management prior to surgical intervention.\n\nRespectfully,\nPriya Sharma\nBilling Specialist`,
        grounded: true
      }
    });

    if (seededEvidences["seed-doc-1001-cn"]) {
      await prisma.appealCitation.upsert({
        where: { appealLetterId_evidenceId: { appealLetterId: letter1001.id, evidenceId: seededEvidences["seed-doc-1001-cn"].id } },
        update: { excerpt: "Pre-operative evaluation confirms grade IV osteoarthritis with persistent joint pain." },
        create: { appealLetterId: letter1001.id, evidenceId: seededEvidences["seed-doc-1001-cn"].id, excerpt: "Pre-operative evaluation confirms grade IV osteoarthritis with persistent joint pain." }
      });
    }

    // Record 2 (CLM-1002): REJECTED Appeal (Deny in Appeal Queue)
    const rejectedLetter1002 = await prisma.appealLetter.upsert({
      where: { id: "seed-letter-1002" },
      update: {
        subject: "Appeal for Claim CLM-1002 - Ananya Reddy",
        status: "REJECTED",
        reviewerId: reviewer1.id,
        reviewerComment: "Appeal rejected: The submitted records do not include pre-operative authorization or emergency admission justification.",
        reviewedAt: date("2025-02-18T16:00:00Z"),
        submittedAt: date("2025-02-15T11:00:00Z"),
        content: `Bharat Health Assurance Grievance Cell\n\nSubject: Appeal for Claim CLM-1002\nPatient: Ananya Reddy\nHospital: Sri Venkateswara Multispeciality Hospital\nPolicy Number: BHA-POL-2025-1092\n\nDear Appeals Committee,\n\nWe request reconsideration of denied claim CLM-1002 for laparoscopic cholecystectomy.\n\nRespectfully,\nPriya Sharma\nBilling Specialist`,
        grounded: true
      },
      create: {
        id: "seed-letter-1002",
        claimId: claims["seed-claim-1002"].id,
        authorId: billing1.id,
        reviewerId: reviewer1.id,
        generationKey: "seed-gen-key-1002",
        subject: "Appeal for Claim CLM-1002 - Ananya Reddy",
        status: "REJECTED",
        reviewerComment: "Appeal rejected: The submitted records do not include pre-operative authorization or emergency admission justification.",
        reviewedAt: date("2025-02-18T16:00:00Z"),
        submittedAt: date("2025-02-15T11:00:00Z"),
        content: `Bharat Health Assurance Grievance Cell\n\nSubject: Appeal for Claim CLM-1002\nPatient: Ananya Reddy\nHospital: Sri Venkateswara Multispeciality Hospital\nPolicy Number: BHA-POL-2025-1092\n\nDear Appeals Committee,\n\nWe request reconsideration of denied claim CLM-1002 for laparoscopic cholecystectomy.\n\nRespectfully,\nPriya Sharma\nBilling Specialist`,
        grounded: true
      }
    });

    if (seededEvidences["seed-doc-1002-cn"]) {
      await prisma.appealCitation.upsert({
        where: { appealLetterId_evidenceId: { appealLetterId: rejectedLetter1002.id, evidenceId: seededEvidences["seed-doc-1002-cn"].id } },
        update: { excerpt: "Patient underwent laparoscopic cholecystectomy for symptomatic cholelithiasis." },
        create: { appealLetterId: rejectedLetter1002.id, evidenceId: seededEvidences["seed-doc-1002-cn"].id, excerpt: "Patient underwent laparoscopic cholecystectomy for symptomatic cholelithiasis." }
      });
    }

    await prisma.appealReview.upsert({
      where: { id: "seed-ar-1002-1" },
      update: {
        decision: "REJECTED",
        reviewerComment: "Appeal rejected: The submitted records do not include pre-operative authorization or emergency admission justification."
      },
      create: {
        id: "seed-ar-1002-1",
        appealLetterId: rejectedLetter1002.id,
        reviewerId: reviewer1.id,
        decision: "REJECTED",
        reviewerComment: "Appeal rejected: The submitted records do not include pre-operative authorization or emergency admission justification."
      }
    });

    // Record 3 (CLM-1003): SUBMITTED_FOR_REVIEW Appeal (Needs Review!)
    const submittedLetter = await prisma.appealLetter.upsert({
      where: { id: "seed-letter-1003" },
      update: {
        subject: "Formal Appeal - Claim CLM-1003 - Suresh Babu",
        status: "SUBMITTED_FOR_REVIEW",
        submittedAt: date("2025-02-28T10:30:00Z"),
        reviewerId: reviewer1.id,
        content: `Bharat Health Assurance Appeals Committee\n\nSubject: Appeal request - Claim CLM-1003\nPatient: Suresh Babu\nHospital: Sri Venkateswara Multispeciality Hospital\nPolicy Number: BHA-POL-2024-5519\n\nDear Appeals Committee,\n\nWe request urgent approval of Claim CLM-1003. The patient was admitted emergently at 02:45 AM for acute appendicitis. Our hospital notified Bharat Health Assurance within 4 hours, well within emergency admission guidelines.\n\nRespectfully,\nPriya Sharma\nBilling Specialist`,
        grounded: true
      },
      create: {
        id: "seed-letter-1003",
        claimId: claims["seed-claim-1003"].id,
        authorId: billing1.id,
        reviewerId: reviewer1.id,
        generationKey: "seed-gen-key-1003",
        subject: "Formal Appeal - Claim CLM-1003 - Suresh Babu",
        status: "SUBMITTED_FOR_REVIEW",
        submittedAt: date("2025-02-28T10:30:00Z"),
        content: `Bharat Health Assurance Appeals Committee\n\nSubject: Appeal request - Claim CLM-1003\nPatient: Suresh Babu\nHospital: Sri Venkateswara Multispeciality Hospital\nPolicy Number: BHA-POL-2024-5519\n\nDear Appeals Committee,\n\nWe request urgent approval of Claim CLM-1003. The patient was admitted emergently at 02:45 AM for acute appendicitis. Our hospital notified Bharat Health Assurance within 4 hours, well within emergency admission guidelines.\n\nRespectfully,\nPriya Sharma\nBilling Specialist`,
        grounded: true
      }
    });

    if (seededEvidences["seed-doc-1003-auth"]) {
      await prisma.appealCitation.upsert({
        where: { appealLetterId_evidenceId: { appealLetterId: submittedLetter.id, evidenceId: seededEvidences["seed-doc-1003-auth"].id } },
        update: { excerpt: "Emergency admission notification: Patient Suresh Babu admitted via emergency department with acute appendicitis." },
        create: { appealLetterId: submittedLetter.id, evidenceId: seededEvidences["seed-doc-1003-auth"].id, excerpt: "Emergency admission notification: Patient Suresh Babu admitted via emergency department with acute appendicitis." }
      });
    }
  }

  // Legacy test harness seeds if isTest
  if (isTest) {
    const legacyDenials = [
      { id: "seed-denial-001", claimId: "seed-claim-001", denialReasonCode: "CO-50", reasonText: "Documentation does not establish medical necessity.", denialDate: "2025-02-28" },
      { id: "seed-denial-002", claimId: "seed-claim-001", denialReasonCode: "CO-16", reasonText: "Supporting order was not attached.", denialDate: "2025-02-28" },
      { id: "seed-denial-003", claimId: "seed-claim-002", denialReasonCode: "CO-197", reasonText: "Authorization could not be matched.", denialDate: "2025-03-18" },
      { id: "seed-denial-004", claimId: "seed-claim-003", denialReasonCode: "CO-16", reasonText: "Additional documentation is required.", denialDate: "2025-04-22" }
    ];
    for (const denial of legacyDenials) {
      await prisma.denial.upsert({
        where: { id: denial.id },
        update: { ...denial, denialDate: date(denial.denialDate) },
        create: { ...denial, denialDate: date(denial.denialDate) }
      });
    }

    const legacyEvidences = [
      { id: "seed-evidence-001", claimId: "seed-claim-001", createdById: "seed-provider-1", type: "CLINICAL_NOTE", sourceLabel: "Synthetic clinic note A", summary: "Synthetic note records the documented symptoms and clinician assessment.", sourceDate: "2025-02-12" },
      { id: "seed-evidence-002", claimId: "seed-claim-001", createdById: "seed-provider-1", type: "IMAGING_REPORT", sourceLabel: "Synthetic imaging report A", summary: "Synthetic report documents the imaging findings referenced in the appeal record.", sourceDate: "2025-02-10" },
      { id: "seed-evidence-003", claimId: "seed-claim-001", createdById: "seed-provider-1", type: "TREATMENT_HISTORY", sourceLabel: "Synthetic treatment summary A", summary: "Synthetic summary records prior conservative treatment attempts.", sourceDate: "2025-02-12" },
      { id: "seed-evidence-004", claimId: "seed-claim-001", createdById: "seed-provider-1", type: "ORDER", sourceLabel: "Synthetic signed order A", summary: "Synthetic signed order for the service is present in the sample record.", sourceDate: "2025-02-13" },
      { id: "seed-evidence-005", claimId: "seed-claim-002", createdById: "seed-provider-1", type: "AUTHORIZATION", sourceLabel: "Synthetic authorization confirmation B", summary: "Synthetic authorization confirmation contains a matching service window.", sourceDate: "2025-03-01" },
      { id: "seed-evidence-006", claimId: "seed-claim-002", createdById: "seed-provider-1", type: "REFERRAL", sourceLabel: "Synthetic referral B", summary: "Synthetic referral record identifies the referring office.", sourceDate: "2025-02-27" },
      { id: "seed-evidence-007", claimId: "seed-claim-003", createdById: "seed-provider-2", type: "CLINICAL_NOTE", sourceLabel: "Synthetic clinic note C", summary: "Synthetic note documents the service context.", sourceDate: "2025-04-07" },
      { id: "seed-evidence-008", claimId: "seed-claim-003", createdById: "seed-provider-2", type: "ORDER", sourceLabel: "Synthetic order C", summary: "Synthetic signed order is present for this sample claim.", sourceDate: "2025-04-08" }
    ];
    for (const spec of legacyEvidences) {
      const { id, claimId, sourceDate, ...fields } = spec;
      await prisma.evidence.upsert({
        where: { id },
        update: { ...fields, claimId: claims[claimId].id, sourceDate: date(sourceDate) },
        create: { ...fields, id, claimId: claims[claimId].id, sourceDate: date(sourceDate) }
      });
    }

    const legacyLetter = await prisma.appealLetter.upsert({
      where: { id: "seed-letter-001" },
      update: { claimId: claims["seed-claim-001"].id, authorId: "seed-provider-1", reviewerId: "seed-reviewer-1", subject: "Synthetic appeal for SYN-2025-0001", status: "IN_REVIEW", content: "Synthetic draft: the submitted record contains the cited clinical note, imaging report, and treatment history." },
      create: { id: "seed-letter-001", claimId: claims["seed-claim-001"].id, authorId: "seed-provider-1", reviewerId: "seed-reviewer-1", subject: "Synthetic appeal for SYN-2025-0001", status: "IN_REVIEW", content: "Synthetic draft: the submitted record contains the cited clinical note, imaging report, and treatment history." }
    });
    for (const evidenceId of ["seed-evidence-001", "seed-evidence-002", "seed-evidence-003"]) {
      const evi = await prisma.evidence.findUnique({ where: { id: evidenceId } });
      if (evi) {
        await prisma.appealCitation.upsert({
          where: { appealLetterId_evidenceId: { appealLetterId: legacyLetter.id, evidenceId } },
          update: { excerpt: evi.summary },
          create: { appealLetterId: legacyLetter.id, evidenceId, excerpt: evi.summary }
        });
      }
    }
  }

  console.log("Database seeded successfully with exactly 3 claims (isTest:", isTest, ")");
}

main().catch((error) => {
  console.error("Synthetic seed failed:", error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
