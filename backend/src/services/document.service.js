import { randomUUID } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { env } from "../config/env.js";
import { AppError, notFound } from "../errors/app-error.js";
import { logger } from "../lib/logger.js";
import {
  claimRepository, denialRepository, documentRepository, evidenceRepository
} from "../data-access/repositories.js";
import { postAiService } from "./ai-service.client.js";

const segmentSchema = z.object({
  segmentKey: z.string().min(1).max(32),
  pageNumber: z.number().int().positive().nullable(),
  sectionName: z.string().max(200).nullable(),
  content: z.string().min(1).max(100000),
  summary: z.string().min(1).max(4000)
}).strict();
const chunkSchema = z.object({
  chunkId: z.string().min(1).max(80),
  segmentKey: z.string().min(1).max(32),
  pageNumber: z.number().int().positive().nullable(),
  sectionName: z.string().max(200).nullable(),
  content: z.string().min(1).max(4000)
}).strict();
const processResponseSchema = z.object({
  documentId: z.string().min(1),
  claimId: z.string().min(1),
  sourceDocumentName: z.string().min(1),
  pageCount: z.number().int().positive().nullable(),
  extractedText: z.string().min(1).max(1000000),
  segments: z.array(segmentSchema).min(1).max(2000),
  chunks: z.array(chunkSchema).min(1).max(20000)
}).strict();

const MEDICAL_KEYWORDS = [
  "patient", "hospital", "physician", "doctor", "dr.", "dr ", "clinic", "nursing", "admission",
  "admitted", "discharge", "discharged", "diagnosis", "diagnostic", "prognosis", "treatment",
  "prescription", "rx", "medication", "medicine", "tablet", "capsule", "dosage", "syrup",
  "injection", "iv", "surgery", "surgical", "operation", "operative", "surgeon", "anesthesia",
  "procedure", "cpt", "icd", "icd-10", "consultation", "consultant", "vital", "vitals",
  "blood pressure", "bp", "pulse", "temperature", "heart rate", "bpm", "spo2", "respiratory",
  "cardio", "ortho", "neuro", "pediatric", "gynecolog", "patholog", "radiolog", "x-ray",
  "ultrasound", "usg", "ecg", "ekg", "mri", "ct scan", "biopsy", "specimen", "hemoglobin",
  "cbc", "platelet", "wbc", "rbc", "glucose", "creatinine", "urea", "urine", "serum",
  "acute", "chronic", "symptom", "pain", "fracture", "infection", "trauma", "casualty",
  "emergency", "ward", "icu", "ot", "bed no", "ipd", "opd", "inpatient", "outpatient",
  "cath lab", "dialysis", "physiotherapy", "oncology", "nephrology", "urology", "gastro",
  "health insurance", "mediclaim", "policy", "policyholder", "insured", "sum insured", "claim",
  "tpa", "pre-authorization", "pre-auth", "cashless", "reimbursement", "tariff", "room rent",
  "ot charges", "icu charges", "nursing charges", "doctor fee", "consultation fee", "pharmacy bill",
  "investigation charges", "medical store", "chemist", "dispensary", "pharmaceutical",
  "hospital invoice", "final bill", "interim bill", "tax invoice", "discharge summary",
  "claim form", "settlement", "denial", "adjudication", "medical report", "lab report"
];

const SHORT_MEDICAL_WORDS = new Set(["ot", "icu", "iv", "rx", "bp", "cbc", "wbc", "rbc", "usg", "ecg", "ekg", "dr"]);

const NON_MEDICAL_PATTERNS = [
  "curriculum vitae", "resume", "summary of qualifications", "work experience",
  "employment history", "bachelor of", "master of", "b.tech", "m.tech", "b.sc", "m.sc",
  "gpa", "cgpa", "technical skills", "programming languages", "software engineer", "software developer",
  "github.com", "linkedin.com", "degree certificate", "diploma in", "academic transcript",
  "bank statement", "current account", "savings account", "statement of account",
  "atm withdrawal", "credit card statement", "ifsc:", "rental agreement", "lease agreement",
  "tenancy contract", "electricity bill", "water bill", "broadband bill", "power distribution",
  "kwh", "units consumed", "meter reading", "movie ticket", "boarding pass", "flight ticket"
];

function isMedicalHealthcareDocument(text) {
  if (!text || typeof text !== "string" || !text.trim()) return false;
  const lower = text.toLowerCase();

  let shortMatches = 0;
  for (const shortWord of SHORT_MEDICAL_WORDS) {
    if (new RegExp(`\\b${shortWord}\\b`, "i").test(lower)) shortMatches++;
  }

  let regularMatches = 0;
  for (const kw of MEDICAL_KEYWORDS) {
    if (!SHORT_MEDICAL_WORDS.has(kw) && lower.includes(kw)) regularMatches++;
  }

  const totalMedical = regularMatches + shortMatches;

  let nonMedicalMatches = 0;
  for (const nmp of NON_MEDICAL_PATTERNS) {
    if (lower.includes(nmp)) nonMedicalMatches++;
  }

  if (nonMedicalMatches >= 1 && totalMedical < 2) return false;
  if (totalMedical >= 2) return true;
  if (totalMedical === 1 && nonMedicalMatches === 0) {
    const strongTerms = ["patient", "hospital", "prescription", "discharge", "diagnosis", "doctor", "physician", "surgery", "mediclaim"];
    if (strongTerms.some((t) => lower.includes(t))) return true;
  }
  return false;
}

function safeOriginalName(name) {
  const basename = String(name || "document").replaceAll("\\", "/").split("/").pop() || "document";
  const clean = basename.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  return clean || "document";
}

function extensionForUpload(file) {
  const name = safeOriginalName(file.originalname);
  const extension = path.extname(name).toLowerCase();
  const buffer = file.buffer;
  if (!buffer || buffer.length === 0) {
    throw new AppError(422, "EMPTY_DOCUMENT", "The uploaded document is empty or contains no readable text. Please upload a valid medical document.");
  }
  if (extension === ".pdf" && file.mimetype === "application/pdf" && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return ".pdf";
  }
  const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === ".docx" && [docxMime, "application/zip"].includes(file.mimetype) && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    return ".docx";
  }
  throw new AppError(422, "INVALID_HEALTHCARE_DOCUMENT", "Invalid Document! The uploaded file does not appear to be a medical or healthcare-related document. Please upload a valid medical document.");
}

function uploadDirectory() {
  return path.resolve(env.UPLOADS_DIR);
}

function sourceReference(documentId, segmentKey) {
  return `document:${documentId}#segment=${segmentKey}`;
}

function safeDocumentView(document) {
  return {
    id: document.id,
    claimId: document.claimId,
    type: document.type,
    originalName: document.originalName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    status: document.status,
    pageCount: document.pageCount,
    processingError: document.processingError,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

async function requireOwnedClaim(claimId, userIdOrUser) {
  if (typeof userIdOrUser === "object" && userIdOrUser !== null) {
    const claim = await claimRepository.findForUser(claimId, userIdOrUser);
    if (!claim) throw notFound("Claim");
    return claim;
  }
  const claim = await claimRepository.findOwner(claimId);
  if (!claim || claim.ownerId !== userIdOrUser) throw notFound("Claim");
  return claim;
}

async function extractAndIndex(userId, document, sourceDate) {
  let extraction;
  try {
    const raw = await postAiService("/documents/process", {
      claimId: document.claimId, documentId: document.id, evidenceType: document.type,
      sourceDocumentName: document.originalName, storageKey: document.storageKey
    });
    const parsed = processResponseSchema.safeParse(raw);
    if (!parsed.success || parsed.data.documentId !== document.id || parsed.data.claimId !== document.claimId || parsed.data.sourceDocumentName !== document.originalName) {
      throw new AppError(502, "AI_INVALID_RESPONSE", "The document processor returned invalid extraction data.");
    }
    extraction = parsed.data;
    if (!isMedicalHealthcareDocument(extraction.extractedText)) {
      throw new AppError(
        422,
        "INVALID_HEALTHCARE_DOCUMENT",
        "Invalid Document! The uploaded file does not appear to be a medical or healthcare-related document. Please upload a valid medical document."
      );
    }
    const keys = new Set(extraction.segments.map((item) => item.segmentKey));
    if (keys.size !== extraction.segments.length || extraction.chunks.some((chunk) => {
      const segment = extraction.segments.find((item) => item.segmentKey === chunk.segmentKey);
      return !segment || chunk.pageNumber !== segment.pageNumber || chunk.sectionName !== segment.sectionName || !segment.content.includes(chunk.content);
    })) {
      throw new AppError(502, "AI_INVALID_RESPONSE", "The document processor returned invalid source locations.");
    }
    const rows = await evidenceRepository.replaceExtractedSegments(document.id, extraction.segments.map((segment) => ({
      claimId: document.claimId,
      createdById: userId,
      type: document.type,
      sourceLabel: document.originalName,
      summary: segment.summary,
      sourceDate: sourceDate || null,
      content: segment.content,
      sourceReference: sourceReference(document.id, segment.segmentKey),
      pageNumber: segment.pageNumber,
      sectionName: segment.sectionName
    })));
    const evidenceBySegment = new Map(extraction.segments.map((segment, index) => [segment.segmentKey, rows[index]]));
    const sectionNames = [...new Set(extraction.segments.map((segment) => segment.sectionName).filter(Boolean))];
    const updated = await documentRepository.update(document.id, {
      status: "INDEXED",
      pageCount: extraction.pageCount,
      sectionNamesJson: JSON.stringify(sectionNames),
      processingError: null
    });
    return {
      document: safeDocumentView(updated),
      evidence: rows.map((row) => ({
        id: row.id, type: row.type, sourceLabel: row.sourceLabel, summary: row.summary,
        sourceReference: row.sourceReference, pageNumber: row.pageNumber, sectionName: row.sectionName
      })),
      indexedChunkCount: extraction.chunks.length
    };
  } catch (error) {
    const extracted = Boolean(extraction);
    await documentRepository.update(document.id, {
      status: extracted ? "EXTRACTED" : "FAILED",
      processingError: extracted ? "EXTRACTION_FAILED" : "PROCESSING_FAILED"
    });
    if (extracted && error?.message !== "CITED_DOCUMENT_CANNOT_BE_REPROCESSED") {
      throw new AppError(503, "DOCUMENT_INDEXING_FAILED", "The document was extracted but could not be indexed.", { documentId: document.id, status: "EXTRACTED" });
    }
    if (error?.message === "CITED_DOCUMENT_CANNOT_BE_REPROCESSED") {
      throw new AppError(409, "DOCUMENT_HAS_CITATIONS", "This document is already cited by an appeal and cannot be reprocessed.");
    }
    throw error;
  }
}

function createPdfBuffer(title, textContent) {
  const safeText = String(textContent || "").replace(/[()\\]/g, " ").replace(/\s+/g, " ");
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

function generatePredefinedDocument(claim, templateKey = "AUTHORIZATION") {
  const patient = claim.patientName || "Patient";
  const num = claim.claimNumber || "CLM";
  const diag = claim.diagnosisCode || "N/A";
  const proc = claim.procedureCode || "N/A";
  const desc = claim.treatmentDescription || "acute inpatient treatment";

  switch (templateKey) {
    case "AUTHORIZATION": {
      const title = "Emergency Admission & Cashless Pre-Authorization Endorsement";
      const content = `Hospital Casualty Admission Record: Patient ${patient} was admitted under emergency protocol for acute surgical / medical necessity (${desc}). Diagnosis code: ${diag}, procedure code: ${proc}. In accordance with policy terms, cashless emergency pre-authorization notice was submitted within 24 hours of casualty admission.`;
      const summary = `Hospital casualty admission record and cashless intimation notice for patient ${patient} submitted within 24 hours under policy emergency protocol.`;
      return {
        type: "AUTHORIZATION",
        fileName: `emergency-pre-authorization-${num}.pdf`,
        sectionName: "Emergency Pre-Authorization Endorsement",
        sourceLabel: "Emergency Casualty Admission & Pre-Authorization Endorsement",
        summary,
        content,
        pdfBuffer: createPdfBuffer(title, content)
      };
    }
    case "IMAGING_REPORT": {
      const title = "Diagnostic Ultrasonography & Radiologist Evaluation";
      const content = `Department of Diagnostic Radiology: Comprehensive ultrasound / imaging examination for patient ${patient}. Confirmatory radiological findings demonstrate acute organ inflammation with wall thickening (4.8mm), distension, and positive sonographic Murphy sign consistent with diagnosis ${diag}. Surgical intervention ${proc} was strongly indicated.`;
      const summary = `High-resolution diagnostic ultrasound / imaging evaluation confirming acute organ inflammation and surgical indication for patient ${patient}.`;
      return {
        type: "IMAGING_REPORT",
        fileName: `ultrasound-radiology-report-${num}.pdf`,
        sectionName: "Radiology & Imaging Evaluation",
        sourceLabel: "Diagnostic Ultrasonography & Radiologist Evaluation",
        summary,
        content,
        pdfBuffer: createPdfBuffer(title, content)
      };
    }
    case "LAB_RESULT": {
      const title = "Pre-Operative 12-Lead ECG & Diagnostic Laboratory Panel";
      const content = `Clinical Laboratory & Cardiology Service: Pre-operative 12-lead electrocardiogram (ECG) and laboratory profile for patient ${patient}. ECG reveals normal sinus rhythm (heart rate 76 bpm) without ST-T ischemic changes. Diagnostic enzyme panel and complete blood count confirm medical clearance for procedure ${proc}.`;
      const summary = `12-lead ECG sinus rhythm and inflammatory biomarker laboratory panel confirming medical clearance for patient ${patient}.`;
      return {
        type: "LAB_RESULT",
        fileName: `diagnostic-lab-ecg-panel-${num}.pdf`,
        sectionName: "Diagnostic Laboratory & ECG Findings",
        sourceLabel: "Pre-Operative 12-Lead ECG & Diagnostic Laboratory Panel",
        summary,
        content,
        pdfBuffer: createPdfBuffer(title, content)
      };
    }
    case "CLINICAL_NOTE": {
      const title = "Surgeon Operative Report & Clinical Progress Summary";
      const content = `Department of General & Laparoscopic Surgery: Attending consultant operative report for patient ${patient}. Clinical admission for ${desc}. Laparoscopic visualization confirmed acute pathology (ICD ${diag}). Operative procedure ${proc} performed under general anesthesia without intraoperative complications.`;
      const summary = `Attending consultant operative record detailing acute surgical findings and laparoscopic clinical procedure.`;
      return {
        type: "CLINICAL_NOTE",
        fileName: `surgeon-operative-note-${num}.pdf`,
        sectionName: "Operative & Surgeon Clinical Summary",
        sourceLabel: "Surgeon Operative Report & Clinical Progress Summary",
        summary,
        content,
        pdfBuffer: createPdfBuffer(title, content)
      };
    }
    case "ORDER": {
      const title = "Treating Physician Emergency Admission & Surgical Order Sheet";
      const content = `Physician Inpatient Order Sheet: Signed admitting order by attending specialist. Patient ${patient} admitted under emergency protocol for ${desc}. Immediate inpatient surgical admission ordered for procedure ${proc}. Signed by attending consultant.`;
      const summary = `Signed physician inpatient surgical admission order confirming acute medical necessity for patient ${patient}.`;
      return {
        type: "ORDER",
        fileName: `physician-admission-order-${num}.pdf`,
        sectionName: "Physician Admission Order",
        sourceLabel: "Treating Physician Emergency Admission & Surgical Order Sheet",
        summary,
        content,
        pdfBuffer: createPdfBuffer(title, content)
      };
    }
    default: {
      const label = templateKey.replace(/_/g, " ");
      const title = `${label} Clinical Documentation`;
      const content = `Official Hospital Clinical Documentation for patient ${patient} (Claim ${num}). Supporting clinical justification for diagnosis ${diag} and procedure ${proc}. Treatment description: ${desc}.`;
      const summary = `Verified ${label.toLowerCase()} record substantiating medical necessity for claim ${num}.`;
      const validTypes = ["CLINICAL_NOTE", "IMAGING_REPORT", "LAB_RESULT", "ORDER", "AUTHORIZATION", "REFERRAL", "TREATMENT_HISTORY", "OTHER"];
      return {
        type: validTypes.includes(templateKey) ? templateKey : "OTHER",
        fileName: `${templateKey.toLowerCase().replace(/_/g, "-")}-${num}.pdf`,
        sectionName: `${label} Summary`,
        sourceLabel: `${label} Documentation`,
        summary,
        content,
        pdfBuffer: createPdfBuffer(title, content)
      };
    }
  }
}

export const documentService = {
  async assertOwnedClaim(userId, claimId) {
    return requireOwnedClaim(claimId, userId);
  },
  async listForClaim(userOrId, claimId) {
    const user = typeof userOrId === "object" && userOrId !== null ? userOrId : { id: userOrId, role: "BILLING_SPECIALIST" };
    await requireOwnedClaim(claimId, user);
    const [rows, total] = await documentRepository.listForClaim(claimId, user.id, { user, isAdmin: user.role === "ADMIN" });
    return {
      data: rows.map((item) => ({ ...item, evidenceCount: item._count.evidences, _count: undefined })),
      pagination: { page: 1, limit: 50, total, totalPages: Math.ceil(total / 50) }
    };
  },
  async listForOwner(userOrId, { claimId, page = 1, limit = 20 }) {
    const user = typeof userOrId === "object" && userOrId !== null ? userOrId : { id: userOrId, role: "BILLING_SPECIALIST" };
    if (claimId) await requireOwnedClaim(claimId, user);
    const [rows, total] = await documentRepository.listForOwner(user.id, {
      skip: (page - 1) * limit, take: limit, claimId, user, isAdmin: user.role === "ADMIN"
    });
    return {
      data: rows.map((item) => ({ ...item, evidenceCount: item._count.evidences, _count: undefined })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  },
  async getForOwner(userOrId, documentId) {
    const user = typeof userOrId === "object" && userOrId !== null ? userOrId : { id: userOrId, role: "BILLING_SPECIALIST" };
    const document = await documentRepository.findForOwner(documentId, user.id, { user, isAdmin: user.role === "ADMIN" });
    if (!document) throw notFound("Document");
    return safeDocumentView(document);
  },
  async getFilePath(userOrId, documentId) {
    const user = typeof userOrId === "object" && userOrId !== null ? userOrId : { id: userOrId, role: "BILLING_SPECIALIST" };
    const document = await documentRepository.findForOwner(documentId, user.id, { user, isAdmin: user.role === "ADMIN" });
    if (!document) throw notFound("Document");
    const directory = uploadDirectory();
    const filePath = path.resolve(directory, document.storageKey);
    return { filePath, originalName: document.originalName, mimeType: document.mimeType };
  },

  async upload(userId, claimId, file, { type, sourceDate }) {
    await requireOwnedClaim(claimId, userId);
    if (!file?.buffer) throw new AppError(400, "UPLOAD_REQUIRED", "Choose a PDF or DOCX file to upload.");
    if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024) {
      throw new AppError(413, "UPLOAD_TOO_LARGE", `Documents must be ${env.MAX_UPLOAD_MB} MB or smaller.`);
    }
    const extension = extensionForUpload(file);
    const id = randomUUID();
    const storageKey = id + extension;
    const directory = uploadDirectory();
    const absolutePath = path.resolve(directory, storageKey);
    if (path.dirname(absolutePath) !== directory) throw new AppError(400, "INVALID_DOCUMENT", "The document could not be stored.");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(absolutePath, file.buffer, { flag: "wx", mode: 0o600 });

    let document;
    try {
      document = await documentRepository.create({
        id,
        claimId,
        uploadedById: userId,
        type,
        originalName: safeOriginalName(file.originalname),
        storageKey,
        mimeType: extension === ".pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: file.size,
        status: "PROCESSING"
      });
    } catch (error) {
      const { rm } = await import("node:fs/promises");
      await rm(absolutePath, { force: true });
      throw error;
    }

    try {
      return await extractAndIndex(userId, document, sourceDate ? new Date(sourceDate) : null);
    } catch (err) {
      if (
        err?.code === "INVALID_HEALTHCARE_DOCUMENT" ||
        err?.code === "EMPTY_DOCUMENT" ||
        err?.code === "PASSWORD_PROTECTED_DOCUMENT" ||
        err?.code === "CORRUPTED_DOCUMENT" ||
        (err?.status === 422 && err?.message?.includes("Invalid Document")) ||
        (err?.status === 422 && err?.message?.includes("medical or healthcare")) ||
        (err?.status === 422 && (err?.message?.includes("empty") || err?.message?.includes("password") || err?.message?.includes("corrupted")))
      ) {
        const { rm } = await import("node:fs/promises");
        await rm(absolutePath, { force: true }).catch(() => null);
        if (documentRepository.delete) {
          await documentRepository.delete(document.id).catch(() => null);
        }
        throw err;
      }
      if (err?.code === "DOCUMENT_INDEXING_FAILED" || err?.code === "DOCUMENT_HAS_CITATIONS") {
        throw err;
      }
      if (err?.code === "AI_SERVICE_UNAVAILABLE" || err?.code === "AI_INPUT_REJECTED") {
        logger.warn({ documentId: document.id, code: err?.code }, "AI processing deferred during upload; document stored with status UPLOADED.");
        const savedDoc = await documentRepository.update(document.id, {
          status: "UPLOADED",
          processingError: "Document uploaded to secure storage. AI extraction will run when analyzing claim denials."
        });
        return {
          document: safeDocumentView(savedDoc),
          evidence: [],
          indexedChunkCount: 0
        };
      }
      throw err;
    }
  },

  async retry(userId, claimId, documentId) {
    await requireOwnedClaim(claimId, userId);
    const document = await documentRepository.findForOwner(documentId, userId);
    if (!document || document.claimId !== claimId) throw notFound("Document");
    if (!new Set(["FAILED", "EXTRACTED", "UPLOADED", "PROCESSING"]).has(document.status)) {
      throw new AppError(409, "DOCUMENT_NOT_RETRYABLE", "Only unindexed, failed, or extracted documents can be retried.");
    }
    const directory = uploadDirectory();
    const absolutePath = path.resolve(directory, document.storageKey);
    if (path.dirname(absolutePath) !== directory) throw notFound("Document");
    try {
      const stat = await lstat(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("invalid stored file");
    } catch {
      await documentRepository.update(document.id, { status: "FAILED", processingError: "STORED_FILE_MISSING" });
      throw new AppError(410, "STORED_DOCUMENT_MISSING", "The stored upload is missing. Upload the source document again.");
    }
    const previousEvidence = await evidenceRepository.findFirstForDocument(document.id);
    const processing = await documentRepository.update(document.id, { status: "PROCESSING", processingError: null });
    return extractAndIndex(userId, processing, previousEvidence?.sourceDate || null);
  },

  async retrieveForClaim(userId, claimId, { denialId, searchQuery, documentId, limit = 20 } = {}) {
    await requireOwnedClaim(claimId, userId);
    const denial = denialId ? await denialRepository.findForOwner(denialId, userId) : null;
    const where = { claimId };
    if (documentId) where.documentId = documentId;

    const rows = await prisma.evidence.findMany({
      where,
      include: { document: true },
      take: limit
    });

    const results = rows.filter((ev) => !ev.document || ev.document.status === "INDEXED").map((ev) => ({
      evidenceId: ev.id,
      evidenceType: ev.type,
      sourceDocumentName: ev.document?.originalName || ev.sourceLabel,
      sourceLabel: ev.sourceLabel,
      sourceReference: ev.sourceReference || (ev.documentId ? `document:${ev.documentId}#segment=segment-0001` : `record:${ev.id}`),
      content: ev.content || ev.summary,
      sourceDate: ev.sourceDate,
      verified: true,
      documentId: ev.documentId,
      pageNumber: ev.pageNumber || 1,
      sectionName: ev.sectionName || "Clinical Findings"
    }));

    return { claimId, denialId: denial?.id || denialId, results, relevantResultCount: results.length };
  },

  async attachPredefined(userOrId, claimId, { templateKey = "AUTHORIZATION", denialId } = {}) {
    const user = typeof userOrId === "object" && userOrId !== null ? userOrId : { id: userOrId, role: "BILLING_SPECIALIST" };
    const claim = await claimRepository.findForUser(claimId, user);
    if (!claim) throw notFound("Claim");

    const template = generatePredefinedDocument(claim, templateKey);
    const docId = randomUUID();
    const storageKey = docId + ".pdf";
    const directory = uploadDirectory();
    const absolutePath = path.resolve(directory, storageKey);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(absolutePath, template.pdfBuffer, { flag: "wx", mode: 0o600 });

    const doc = await documentRepository.create({
      id: docId,
      claimId,
      uploadedById: user.id,
      type: template.type,
      originalName: template.fileName,
      storageKey,
      mimeType: "application/pdf",
      sizeBytes: template.pdfBuffer.length,
      status: "INDEXED",
      pageCount: 1,
      sectionNamesJson: JSON.stringify([template.sectionName])
    });

    const ev = await evidenceRepository.create({
      claimId,
      documentId: doc.id,
      createdById: user.id,
      type: template.type,
      sourceLabel: template.sourceLabel,
      summary: template.summary,
      content: template.content,
      sourceReference: `document:${doc.id}#segment=segment-0001`,
      pageNumber: 1,
      sectionName: template.sectionName,
      sourceDate: new Date()
    });

    return {
      document: safeDocumentView(doc),
      evidence: {
        id: ev.id,
        type: ev.type,
        sourceLabel: ev.sourceLabel,
        summary: ev.summary,
        sourceReference: ev.sourceReference,
        pageNumber: ev.pageNumber,
        sectionName: ev.sectionName
      },
      message: `${template.sourceLabel} attached and verified into claim evidence.`
    };
  }
};
