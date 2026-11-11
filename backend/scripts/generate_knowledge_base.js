import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/db/prisma.js";

// Multi-line, multi-page PDF-1.4 generator in pure Node.js
function buildPdfDocument(title, sections) {
  const pages = [];
  let currentPageLines = [];
  const linesPerPage = 38;

  currentPageLines.push({ text: title, size: 14, font: "F2" });
  currentPageLines.push({ text: "==========================================================================", size: 9, font: "F1" });
  currentPageLines.push({ text: "Official Healthcare & Insurance Knowledge Document", size: 9, font: "F1" });
  currentPageLines.push({ text: "", size: 9, font: "F1" });

  for (const sec of sections) {
    if (currentPageLines.length + 4 > linesPerPage) {
      pages.push([...currentPageLines]);
      currentPageLines = [];
    }
    currentPageLines.push({ text: `SECTION: ${sec.heading}`, size: 11, font: "F2" });
    currentPageLines.push({ text: "--------------------------------------------------------------------------", size: 8, font: "F1" });

    // Split section content into chunks of ~85 characters
    const words = sec.content.split(" ");
    let line = "";
    for (const w of words) {
      if ((line + " " + w).length > 85) {
        if (currentPageLines.length >= linesPerPage) {
          pages.push([...currentPageLines]);
          currentPageLines = [];
        }
        currentPageLines.push({ text: line.trim(), size: 9, font: "F1" });
        line = w;
      } else {
        line = line ? line + " " + w : w;
      }
    }
    if (line) {
      if (currentPageLines.length >= linesPerPage) {
        pages.push([...currentPageLines]);
        currentPageLines = [];
      }
      currentPageLines.push({ text: line.trim(), size: 9, font: "F1" });
    }
    currentPageLines.push({ text: "", size: 9, font: "F1" });
  }

  if (currentPageLines.length > 0) {
    pages.push([...currentPageLines]);
  }

  // Construct PDF objects
  const pageCount = pages.length;
  let objectIndex = 6;
  const pageObjectIds = [];
  const contentObjectIds = [];

  for (let i = 0; i < pageCount; i++) {
    pageObjectIds.push(objectIndex++);
    contentObjectIds.push(objectIndex++);
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [];

  function appendObj(id, content) {
    offsets.push(Buffer.byteLength(pdf, "utf-8"));
    pdf += `${id} 0 obj\n${content}\nendobj\n`;
  }

  // 1: Catalog
  appendObj(1, "<</Type /Catalog /Pages 2 0 R>>");

  // 2: Pages
  const kids = pageObjectIds.map((id) => `${id} 0 R`).join(" ");
  appendObj(2, `<</Type /Pages /Kids [${kids}] /Count ${pageCount}>>`);

  // 3 & 4: Fonts
  appendObj(3, "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>");
  appendObj(4, "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold>>");

  // Resources dict (Obj 5)
  appendObj(5, "<</Font <</F1 3 0 R /F2 4 0 R>>>>");

  // Create each page & content stream
  for (let i = 0; i < pageCount; i++) {
    const pId = pageObjectIds[i];
    const cId = contentObjectIds[i];
    const lines = pages[i];

    let stream = "BT\n";
    let y = 730;
    stream += `/F1 8 Tf\n50 760 Td\n(Document Page ${i + 1} of ${pageCount} | Knowledge Base Reference) Tj\nET\n`;

    stream += "BT\n";
    stream += "50 720 Td\n";
    for (const l of lines) {
      if (!l.text) {
        stream += "0 -14 Td\n";
        continue;
      }
      const font = l.font || "F1";
      const size = l.size || 9;
      const safe = l.text.replace(/[()\\]/g, " ");
      stream += `/${font} ${size} Tf\n(${safe}) Tj\n0 -14 Td\n`;
    }
    stream += "ET\n";

    const streamLen = Buffer.byteLength(stream, "utf-8");
    appendObj(pId, `<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${cId} 0 R /Resources 5 0 R>>`);
    appendObj(cId, `<</Length ${streamLen}>>\nstream\n${stream}\nendstream`);
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf-8");
  pdf += `xref\n0 ${objectIndex}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<</Size ${objectIndex} /Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf-8");
}

export async function generateKnowledgeBase() {
  console.log("\n--- GENERATING KNOWLEDGE BASE DOCUMENTS & CHROMA SEEDS ---\n");

  const kbRoot = path.resolve("./knowledge-base");
  const categories = [
    "insurance-policies",
    "claim-guidelines",
    "denial-guidelines",
    "medical-guidelines",
    "appeal-guidelines"
  ];

  for (const cat of categories) {
    const dir = path.join(kbRoot, cat);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const docDefinitions = [
    // 1. Insurance Policies
    {
      category: "INSURANCE_POLICY",
      subDir: "insurance-policies",
      fileName: "insurer-a-policy.pdf",
      title: "Bharat Health Assurance - Comprehensive Health Insurance Policy (Policy Wording Master)",
      organizationId: "org-ins-01",
      scope: "INSURANCE_POLICY_SCOPE",
      sections: [
        {
          heading: "Inpatient Hospitalization Benefits & Room Rent Terms",
          content: "Under Section 1.1, the company will cover reasonable and customary hospitalization expenses incurred for medically necessary treatment of illness or accidental bodily injury. Room rent is eligible up to 1 percent of Sum Insured per day. Intensive Care Unit (ICU) charges are covered up to 2 percent of Sum Insured per day. Medical practitioner fees, surgeon, anesthetist, and consultant charges are reimbursable subject to standard schedule of hospital tariffs."
        },
        {
          heading: "Clause 4.2 - Medical Necessity Verification Requirement",
          content: "Medical necessity is a strict condition precedent to liability. Any elective inpatient admission or surgical intervention must be substantiated by demonstrable clinical findings, diagnostic investigation reports (such as radiographs, CT, MRI, laboratory test panels), and documentation of conservative treatment trial where indicated. Interventions performed primarily for diagnostic or evaluation purposes without active therapeutic treatment are excluded under Clause 4.2.1."
        },
        {
          heading: "Clause 4.3 - Pre-Authorization and Emergency Intimation Protocol",
          content: "For all planned elective procedures, the insured or healthcare provider hospital must obtain formal written pre-authorization at least 72 hours prior to admission by submitting the completed cashless request form along with doctor consultation notes. In the event of an emergency admission, cashless intimation must be submitted to the company's Third Party Administrator (TPA) within 24 hours of hospitalization or prior to discharge, whichever is earlier. Delayed intimation without valid clinical emergency justification may lead to denial of cashless settlement."
        },
        {
          heading: "Clause 5.1 - Specific Illness Waiting Periods & Exclusions",
          content: "A statutory 24-month waiting period applies from the policy inception date for specified medical conditions including: joint replacement surgeries for non-traumatic osteoarthritis; benign prostatic hypertrophy; calculus diseases of the gallbladder (cholelithiasis) and urinary tract; all types of hernia; and degenerative spinal disc disorders. Any claim for these procedures during the waiting period is denied unless substantiated by emergency neurosurgical or orthopedic trauma indication."
        }
      ]
    },
    {
      category: "INSURANCE_POLICY",
      subDir: "insurance-policies",
      fileName: "insurer-a-coverage-guidelines.pdf",
      title: "Bharat Health Assurance - Inpatient, Daycare & Emergency Coverage Guidelines",
      organizationId: "org-ins-01",
      scope: "INSURANCE_POLICY_SCOPE",
      sections: [
        {
          heading: "Daycare Surgical Procedures Coverage",
          content: "Medical advances allowing surgical operations and procedures undertaken under general or local anesthesia in a hospital/daycare center in less than 24 hours are covered. Covered daycare interventions include cataract surgeries, laparoscopic appendectomy, laparoscopic cholecystectomy, coronary angiography, dialysis, and targeted chemotherapy sessions. Outpatient consultations and non-surgical diagnostic investigations remain non-payable."
        },
        {
          heading: "Cashless Authorization Desk Operating Protocol",
          content: "The hospital cashless coordination desk must transmit the Pre-Authorization Request Form (Form C) along with verified patient government photo ID, active policy card, treating doctor's clinical history, admission slip, and estimated bill. The insurance company medical audit desk will communicate initial cashless approval, query, or denial within 3 hours of receiving complete documentation."
        }
      ]
    },
    {
      category: "INSURANCE_POLICY",
      subDir: "insurance-policies",
      fileName: "insurer-a-exclusions.pdf",
      title: "Bharat Health Assurance - Specific Exclusions, Sub-Limits & Non-Payable Expenses",
      organizationId: "org-ins-01",
      scope: "INSURANCE_POLICY_SCOPE",
      sections: [
        {
          heading: "General Policy Exclusions & Unproven Interventions",
          content: "Expenses related to any admission primarily for bed rest, nursing care, or custodial rehabilitation without active medical intervention are excluded. Experimental, investigational, or unproven medical treatments not endorsed by Indian medical regulatory bodies (ICMR/NMC) are not payable. Cosmetic, aesthetic, or plastic surgeries are excluded except when required as reconstructive surgery following traumatic burns or cancer resection."
        },
        {
          heading: "Advanced Surgical Technologies Sub-Limit Schedule",
          content: "Robotic assisted surgeries, balloon sinuplasty, and stem cell therapies are covered up to a specific sub-limit of fifty percent of base sum insured, unless explicit clinical justification is provided by the consultant surgeon demonstrating that standard laparoscopic or open surgical approaches carry unacceptable patient morbidity."
        }
      ]
    },
    {
      category: "INSURANCE_POLICY",
      subDir: "insurance-policies",
      fileName: "insurer-b-policy.pdf",
      title: "Aarogya General Insurance - Standard Health Insurance Policy Terms",
      organizationId: "org-ins-02",
      scope: "INSURANCE_POLICY_SCOPE",
      sections: [
        {
          heading: "Aarogya General Insurance - Coverage & Network Hospital Terms",
          content: "Aarogya General Insurance covers in-hospital medical and surgical treatment across all accredited network healthcare providers. Inpatient admissions require a minimum 24-hour stay except for listed daycare interventions. A standard 15 percent co-payment clause applies to claims filed for treatment in non-preferred network hospitals in Tier-1 metropolitan zones."
        },
        {
          heading: "Pre-Authorization & Claim Submission Windows",
          content: "Pre-authorization must be submitted 48 hours prior to elective surgeries. Final discharge bills and original payment receipts must be dispatched to the claims audit office within 15 days of patient discharge for post-hospitalization reimbursement reconciliation."
        }
      ]
    },

    // 2. Claim Submission Guidelines
    {
      category: "CLAIM_GUIDELINE",
      subDir: "claim-guidelines",
      fileName: "claim-submission-guidelines.pdf",
      title: "Hospital Claim Submission Guidelines, Mandatory Checklist & Deadlines",
      organizationId: null,
      scope: "SHARED_REFERENCE_SCOPE",
      sections: [
        {
          heading: "Mandatory Filing Timelines for Healthcare Providers",
          content: "All network and non-network healthcare providers must submit final claim packages within thirty calendar days from the date of patient discharge. In cases of ongoing post-hospitalization follow-up, supplementary bills may be submitted within ninety days, referencing the primary claim number. Failure to meet the 30-day timeline without documented force majeure or medical emergency will trigger Timely Filing Denials under code TIMELY-01."
        },
        {
          heading: "Core Claim Submission Package Elements",
          content: "Every claim submission package must include: 1. Completed and signed Insurance Claim Form (Part A by Insured, Part B by Hospital). 2. Original detailed Discharge Summary bearing treating consultant's signature and hospital seal. 3. Itemized final hospital bill with serial numbered service lines. 4. Original pharmacy bills supported by doctor prescription charts. 5. Diagnostic and imaging reports confirming the primary diagnosis."
        }
      ]
    },
    {
      category: "CLAIM_GUIDELINE",
      subDir: "claim-guidelines",
      fileName: "required-document-checklist.pdf",
      title: "Mandatory Clinical Records, Itemized Bills & Diagnostic Documentation Checklist",
      organizationId: null,
      scope: "SHARED_REFERENCE_SCOPE",
      sections: [
        {
          heading: "Surgical Case Document Requirements",
          content: "For surgical interventions (such as Total Knee Replacement, Cholecystectomy, Microdiscectomy, or Cardiac Stenting), the hospital must provide: Detailed operative record describing surgical steps and findings; Anesthesia pre-operative evaluation and intra-operative monitoring record; Implant invoices with manufacturer serial numbers, batch numbers, and barcode stickers pasted into case notes; and Histopathology report for excised tissue."
        },
        {
          heading: "Medical Intensive Care Unit (ICU) Document Requirements",
          content: "For acute medical admissions requiring intensive care, the dossier must include: Daily consultant progress notes; ICU flow sheets showing vital signs recording every 1 to 2 hours; Arterial Blood Gas (ABG) reports, serum lactate, and organ function panels; and Clinical rationale for prolonged ICU stay exceeding forty-eight hours."
        }
      ]
    },
    {
      category: "CLAIM_GUIDELINE",
      subDir: "claim-guidelines",
      fileName: "billing-guidelines.pdf",
      title: "Healthcare Provider Billing & Coding Compliance Guidelines",
      organizationId: null,
      scope: "SHARED_REFERENCE_SCOPE",
      sections: [
        {
          heading: "Coding Specificity and Unbundling Prohibitions",
          content: "Hospitals must adhere to standard ICD-10-CM diagnosis coding and CPT procedure coding. All secondary diagnoses and co-morbidities affecting inpatient length of stay must be coded. Unbundling of surgical component codes (such as separately billing exploration or incision during a primary laparotomy) is strictly prohibited and results in automatic line-item rejection."
        },
        {
          heading: "Pharmacy and Consumables Tariff Regularization",
          content: "All medications and surgical consumables must be billed at or below the Maximum Retail Price (MRP). High-cost surgical devices, biological meshes, and stents must be billed with original supplier invoice copies attached."
        }
      ]
    },

    // 3. Denial Guidelines
    {
      category: "DENIAL_GUIDELINE",
      subDir: "denial-guidelines",
      fileName: "denial-code-reference.pdf",
      title: "Healthcare Insurance Claim Denial Code Master Reference Guide",
      organizationId: null,
      scope: "SHARED_REFERENCE_SCOPE",
      sections: [
        {
          heading: "Standard Denial Codes & Definitions",
          content: "AUTH-01 (Prior Authorization Missing): Elective procedure performed without pre-approval or emergency intimation exceeded window. MED-01 (Medical Necessity Not Established): Clinical evidence fails to justify acute hospitalization or chosen surgical procedure over conservative alternatives. DOC-01 (Insufficient Clinical Documentation): Critical records (operative notes, lab results, imaging reports) omitted from dossier. POLICY-01 (Policy Exclusion / Waiting Period): Condition falls under statutory waiting period or policy general exclusion. TIMELY-01 (Timely Filing Exceeded): Claim submitted beyond the 30-day post-discharge window."
        },
        {
          heading: "Denial Adjudication Standards for Reviewers",
          content: "Insurance compliance reviewers must cite specific contract clauses when issuing claim denials. A generic statement such as 'not covered' is invalid. The reviewer must state the exact clause number, explain what clinical evidence is lacking, and identify the required remedial documents for hospital reconsideration."
        }
      ]
    },
    {
      category: "DENIAL_GUIDELINE",
      subDir: "denial-guidelines",
      fileName: "denial-reasons.pdf",
      title: "Payer Adjudication Protocols, Clinical Rejection Scenarios & Coverage Criteria",
      organizationId: null,
      scope: "SHARED_REFERENCE_SCOPE",
      sections: [
        {
          heading: "Medical Necessity Rejection Scenarios",
          content: "A claim for Total Knee Arthroplasty (TKA) is denied under MED-01 when the medical records show mild-to-moderate radiologic joint space narrowing without documented failed conservative management. Payer guidelines require evidence of Kellgren-Lawrence Grade 3 or 4 joint degeneration and severe functional disability before arthroplasty approval."
        },
        {
          heading: "Emergency Cashless Rejection Scenarios",
          content: "Cashless authorization is denied under AUTH-01 if emergency admission intimation is sent after elective operating hours without trauma casualty triage records. To overturn this, the hospital must furnish emergency room admission charts proving acute hemodynamically unstable presentation."
        }
      ]
    },
    {
      category: "DENIAL_GUIDELINE",
      subDir: "denial-guidelines",
      fileName: "corrective-actions.pdf",
      title: "Denial Corrective Action Plans, Supplemental Evidence Matrix & Reconsideration Protocols",
      organizationId: null,
      scope: "SHARED_REFERENCE_SCOPE",
      sections: [
        {
          heading: "Remedial Evidence Matrix by Denial Code",
          content: "For AUTH-01: Submit Emergency Department triage notes, admission vitals, and physician certification of acute life-threatening onset. For MED-01: Submit historical prescription records, physiotherapy logs proving failed conservative therapy, and consultant letter confirming structural pathology. For DOC-01: Compile missing operative notes, pathology reports, and signed consultant discharge summary. For POLICY-01: Furnish previous continuous coverage certificates from prior insurance policies to waive waiting periods under portability rules."
        }
      ]
    },

    // 4. Medical Guidelines
    {
      category: "MEDICAL_GUIDELINE",
      subDir: "medical-guidelines",
      fileName: "icd10-coding-guidelines.pdf",
      title: "ICD-10 Clinical Coding Guidelines & Diagnostic Specificity Rules",
      organizationId: null,
      scope: "SHARED_REFERENCE_SCOPE",
      sections: [
        {
          heading: "Diagnostic Specificity Rules for Primary Conditions",
          content: "Clinicians and coders must specify laterality, severity, and etiology: Code M17.11 for primary unilateral osteoarthritis of right knee; Code M17.12 for left knee. Code K80.00 for calculus of gallbladder with acute cholecystitis without obstruction. Code I21.9 for acute myocardial infarction, unspecified. Code M51.26 for other intervertebral disc displacement, lumbar region. Non-specific codes (such as 'knee pain' or 'abdominal colic') without underlying etiology will trigger claim rejection."
        }
      ]
    },
    {
      category: "MEDICAL_GUIDELINE",
      subDir: "medical-guidelines",
      fileName: "medical-necessity-guidelines.pdf",
      title: "Clinical Criteria for Medical Necessity, Acute Hospitalization & Surgical Interventions",
      organizationId: null,
      scope: "SHARED_REFERENCE_SCOPE",
      sections: [
        {
          heading: "Total Knee Arthroplasty (TKA) Clinical Criteria",
          content: "Total knee replacement is medically necessary when: 1. Patient has severe Grade 3 or 4 Kellgren-Lawrence osteoarthritis verified on weight-bearing radiographs. 2. Debilitating joint pain (Visual Analog Scale VAS score >= 7) significantly impairs daily living activities. 3. At least 6 months of documented conservative management (including NSAIDs, physical therapy, weight reduction, and/or intra-articular injections) has failed to provide relief."
        },
        {
          heading: "Acute Coronary Interventions & Spine Surgery Criteria",
          content: "Percutaneous coronary intervention (PCI/stenting) is medically necessary when coronary angiography demonstrates >= 70 percent stenosis in a major epicardial coronary artery with acute ischemic symptoms or positive stress test. Lumbar microdiscectomy is indicated for acute disc herniation with progressive motor deficit (cauda equina syndrome, foot drop) or radicular pain refractory to 6 weeks of conservative care."
        }
      ]
    },
    {
      category: "MEDICAL_GUIDELINE",
      subDir: "medical-guidelines",
      fileName: "clinical-documentation-guidelines.pdf",
      title: "Physician Order Sheets, Operative Notes, Lab & Imaging Documentation Standards",
      organizationId: null,
      scope: "SHARED_REFERENCE_SCOPE",
      sections: [
        {
          heading: "Clinical Record Authenticity Standards",
          content: "All clinical entries must include date, exact timestamp, treating clinician name, registration number, and physical or authenticated digital signature. Operative summaries must specify exact prosthetic implants, serial numbers, and surgical approach used. Radiologist and pathologist diagnostic reports must be certified by registered specialists."
        }
      ]
    },

    // 5. Appeal Guidelines
    {
      category: "APPEAL_GUIDELINE",
      subDir: "appeal-guidelines",
      fileName: "appeal-process.pdf",
      title: "Formal Health Insurance Claim Appeal & Reconsideration Procedure",
      organizationId: null,
      scope: "SHARED_REFERENCE_SCOPE",
      sections: [
        {
          heading: "Level-1 Clinical Grievance and Appeal Protocol",
          content: "Following receipt of a formal claim denial notice, the hospital billing specialist may submit a Level-1 Appeal for Reconsideration within thirty days. The appeal must clearly state the claim number, dispute grounds, and provide point-by-point clinical refutation supported by attached medical evidence. The insurance company's medical audit committee must adjudicate and respond within fifteen business days."
        },
        {
          heading: "Level-2 Escalation and Insurance Ombudsman",
          content: "If the Level-1 appeal is rejected and the hospital or patient disputes the determination, the matter may be escalated to the Insurance Ombudsman under IRDAI Grievance Redressal Regulations or referred for joint clinical arbitration."
        }
      ]
    },
    {
      category: "APPEAL_GUIDELINE",
      subDir: "appeal-guidelines",
      fileName: "appeal-documentation-checklist.pdf",
      title: "Appeal Evidence Compilation Checklist & Supporting Record Standards",
      organizationId: null,
      scope: "SHARED_REFERENCE_SCOPE",
      sections: [
        {
          heading: "Mandatory Supporting Evidence Compilation Checklist",
          content: "A successful appeal submission package must compile: 1. Official Appeal Letter on hospital letterhead signed by Head of Medical Administration or Billing. 2. Treating physician's detailed Letter of Medical Necessity answering the specific denial reasons. 3. Chronological medical history proving prior conservative care. 4. Diagnostic imaging films/reports with radiologist certification. 5. Exact policy clause citations demonstrating coverage eligibility."
        }
      ]
    },
    {
      category: "APPEAL_GUIDELINE",
      subDir: "appeal-guidelines",
      fileName: "sample-appeal-letters.pdf",
      title: "Approved Medical Appeal Letter Templates & Case Citations Reference",
      organizationId: null,
      scope: "SHARED_REFERENCE_SCOPE",
      sections: [
        {
          heading: "Template 1 - Medical Necessity Appeal for Joint Arthroplasty (Denial MED-01)",
          content: "To: Medical Director, Insurance Review Board. Re: Appeal of Claim Denial CLM-1001 for Patient Ramesh Kumar (Policy POL-BHA-2025-8812). Dear Medical Director, We write to formally appeal the denial issued under Code MED-01 (Medical Necessity Not Established). Enclosed clinical records confirm the patient presented with severe Kellgren-Lawrence Grade 4 osteoarthritis of the right knee with complete joint space loss (Imaging Report, Page 1). The patient underwent 9 months of conservative therapy without relief (Clinical Summary, Section 2). In accordance with Clause 4.2 of Policy Wording, total knee arthroplasty was clinically indicated. We request immediate reversal and claim disbursement."
        },
        {
          heading: "Template 2 - Emergency Admission Intimation Appeal (Denial AUTH-01)",
          content: "To: Claims Audit Desk. Re: Cashless Denial Appeal for Emergency Appendectomy. Dear Reviewer, We request reconsideration of denial AUTH-01 for patient admitted acutely via Emergency Triage with acute appendicitis and localized peritonitis. As detailed in the Emergency Intimation Record, cashless notification was transmitted at 02:45 AM within 4 hours of arrival. Under Clause 4.3 of policy terms, emergency admissions are exempt from the 72-hour pre-auth window. We request prompt claim approval."
        }
      ]
    }
  ];

  for (const doc of docDefinitions) {
    const filePath = path.join(kbRoot, doc.subDir, doc.fileName);
    const pdfBuffer = buildPdfDocument(doc.title, doc.sections);
    writeFileSync(filePath, pdfBuffer);
    console.log(`Generated PDF: ${doc.subDir}/${doc.fileName} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);

    // Insert or update KnowledgeDocument record in SQLite
    await prisma.knowledgeDocument.upsert({
      where: { id: `kb-${doc.fileName.replace(/\.pdf$/, "")}` },
      update: {
        title: doc.title,
        fileName: doc.fileName,
        filePath,
        category: doc.category,
        organizationId: doc.organizationId,
        scope: doc.scope,
        fileSize: pdfBuffer.length,
        indexingStatus: "INDEXED",
        indexedAt: new Date()
      },
      create: {
        id: `kb-${doc.fileName.replace(/\.pdf$/, "")}`,
        title: doc.title,
        fileName: doc.fileName,
        filePath,
        category: doc.category,
        organizationId: doc.organizationId,
        scope: doc.scope,
        fileSize: pdfBuffer.length,
        indexingStatus: "INDEXED",
        indexedAt: new Date()
      }
    });
  }

  console.log(`\n✔ All 16 knowledge base documents generated and recorded in SQLite database!`);
  return docDefinitions;
}

// Execute if run directly
if (process.argv[1]?.endsWith("generate_knowledge_base.js")) {
  generateKnowledgeBase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

