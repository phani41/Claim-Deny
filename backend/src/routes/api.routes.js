import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { apiController } from "../controllers/api.controller.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";

const router = Router();
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();
const documentParams = z.object({ id: z.string().min(1).max(64), documentId: z.string().min(1).max(64) }).strict();
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}).strict();
const claimQuery = pageQuery.extend({
  status: z.enum(["RECEIVED", "SUBMITTED", "DENIED", "UNDER_REVIEW", "APPEAL_DRAFT", "SUBMITTED_FOR_REVIEW", "APPROVED", "REJECTED", "APPEALED", "PAID", "CLOSED"]).optional(),
  search: z.string().trim().min(1).max(50).optional()
}).strict();
const appealQuery = pageQuery.extend({
  claimId: z.string().min(1).max(64).optional(),
  status: z.enum(["DRAFT", "REQUIRES_CORRECTION", "IN_REVIEW", "SUBMITTED_FOR_REVIEW", "APPROVED", "REJECTED", "SUBMITTED"]).optional()
}).strict();
const evidenceQuery = pageQuery.extend({ claimId: z.string().min(1).max(64).optional() }).strict();
const denialQuery = pageQuery.extend({
  claimId: z.string().min(1).max(64).optional(),
  status: z.string().optional()
});
const documentQuery = pageQuery.extend({ claimId: z.string().min(1).max(64).optional() }).strict();
const orgQuery = pageQuery.extend({
  type: z.enum(["HOSPITAL", "INSURANCE_COMPANY"]).optional()
}).passthrough();
const userQuery = pageQuery.extend({
  search: z.string().trim().min(1).max(50).optional(),
  role: z.enum(["ADMIN", "BILLING_SPECIALIST", "COMPLIANCE_REVIEWER", "REVIEWER", "PROVIDER"]).optional()
}).strict();

const loginBody = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128)
}).strict();

const createUserBody = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(2).max(100),
  role: z.enum(["ADMIN", "BILLING_SPECIALIST", "COMPLIANCE_REVIEWER", "REVIEWER", "PROVIDER"]).default("BILLING_SPECIALIST"),
  organizationId: z.string().min(1).max(64).optional(),
  password: z.string().min(6).max(128),
  active: z.boolean().default(true)
}).strict();

const userStatusBody = z.object({
  active: z.boolean()
}).strict();

const userRoleBody = z.object({
  role: z.enum(["ADMIN", "BILLING_SPECIALIST", "COMPLIANCE_REVIEWER", "REVIEWER", "PROVIDER"])
}).strict();

const amount = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, "Amount must be a decimal with at most two fractional digits.");
const createClaimBody = z.object({
  claimNumber: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9-]+$/),
  patientName: z.string().trim().min(2).max(100).optional(),
  hospitalName: z.string().trim().min(2).max(150).optional(),
  payerName: z.string().trim().min(2).max(100).optional(),
  insuranceOrganizationId: z.string().min(1).max(64).optional(),
  policyNumber: z.string().trim().min(2).max(100).optional(),
  diagnosisCode: z.string().trim().min(1).max(50).optional(),
  procedureCode: z.string().trim().min(1).max(50).optional(),
  treatmentDescription: z.string().trim().min(2).max(2000).optional(),
  serviceDate: z.string().datetime(),
  amount,
  currency: z.string().trim().length(3).default("INR"),
  status: z.enum(["RECEIVED", "SUBMITTED", "DENIED", "UNDER_REVIEW", "APPEAL_DRAFT", "SUBMITTED_FOR_REVIEW", "APPROVED", "REJECTED", "APPEALED", "PAID", "CLOSED"]).optional()
}).strict();

const reviewClaimBody = z.object({
  decision: z.enum(["APPROVED", "DENIED"]),
  denialCode: z.string().trim().min(1).max(50).optional(),
  denialExplanation: z.string().trim().min(1).max(2000).optional(),
  reviewComments: z.string().trim().max(2000).optional()
}).strict();

const createEvidenceBody = z.object({
  claimId: z.string().min(1).max(64),
  type: z.enum(["CLINICAL_NOTE", "IMAGING_REPORT", "LAB_RESULT", "ORDER", "AUTHORIZATION", "REFERRAL", "TREATMENT_HISTORY", "OTHER"]),
  sourceLabel: z.string().trim().min(2).max(120),
  summary: z.string().trim().min(5).max(4000),
  sourceDate: z.string().datetime().optional()
}).strict();

const uploadDocumentBody = z.object({
  type: z.enum(["CLINICAL_NOTE", "IMAGING_REPORT", "LAB_RESULT", "ORDER", "AUTHORIZATION", "REFERRAL", "TREATMENT_HISTORY", "OTHER"]),
  sourceDate: z.string().datetime().optional()
}).strict();

const rootUploadDocumentBody = uploadDocumentBody.extend({ claimId: z.string().min(1).max(64) }).strict();

const attachPredefinedBody = z.object({
  templateKey: z.string().trim().min(1).max(100).optional(),
  denialId: z.string().min(1).max(64).optional()
}).strict();

const evidenceRetrieveBody = z.object({
  denialId: z.string().min(1).max(64).optional(),
  searchQuery: z.string().trim().min(2).max(2000).optional(),
  documentId: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8)
}).strict();

const generateBody = evidenceRetrieveBody.extend({
  generationKey: z.string().min(1).max(128).optional()
}).strict();
const aiRunBody = generateBody.extend({ claimId: z.string().min(1).max(64) }).strict();
const analyzeRejectionBody = z.object({ letterId: z.string().min(1).max(64).optional() }).strict();
const analyzeDenialBody = z.object({ denialId: z.string().min(1).max(64).optional() }).strict();

const updateAppealBody = z.object({
  content: z.string().trim().min(1).max(50000).optional(),
  reviewerId: z.string().min(1).max(64).nullable().optional(),
  expectedUpdatedAt: z.string().datetime().optional()
}).strict().refine((value) => Object.hasOwn(value, "content") || Object.hasOwn(value, "reviewerId"));

const reviseAppealBody = z.object({
  content: z.string().trim().min(1).max(50000).optional(),
  expectedUpdatedAt: z.string().datetime().optional()
}).strict();

const submitAppealBody = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
  reviewerId: z.string().min(1).max(64).nullable().optional()
}).strict();

const approveAppealBody = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
  reviewerComment: z.string().trim().max(4000).optional(),
  comment: z.string().trim().max(4000).optional(),
  confirmUnverifiedDraft: z.boolean().default(false),
  acceptMissingEvidence: z.boolean().default(false)
}).strict();

const rejectAppealBody = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
  reviewerComment: z.string().trim().min(1).max(4000).optional(),
  comment: z.string().trim().min(1).max(4000).optional(),
  feedback: z.string().trim().min(1).max(4000).optional()
}).transform((val) => ({
  expectedUpdatedAt: val.expectedUpdatedAt,
  reviewerComment: val.reviewerComment || val.comment || val.feedback
})).refine((val) => Boolean(val.reviewerComment), { message: "Rejection comment is required" });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 2, fieldSize: 4096 },
  fileFilter(_req, file, callback) {
    const ext = file.originalname.toLowerCase().split(".").pop();
    const accepted = (ext === "pdf" && file.mimetype === "application/pdf")
      || (ext === "docx" && ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"].includes(file.mimetype));
    callback(accepted ? null : new AppError(415, "UNSUPPORTED_DOCUMENT", "Upload a PDF or DOCX file."), accepted);
  }
});

const SPECIALIST_ROLES = ["BILLING_SPECIALIST", "PROVIDER", "ADMIN"];
const REVIEWER_ROLES = ["COMPLIANCE_REVIEWER", "REVIEWER", "ADMIN"];

// Public routes
router.post("/auth/login", validate({ body: loginBody }), asyncHandler(apiController.login));
router.get("/health", asyncHandler(apiController.health));

// Protected routes (all require Bearer token)
router.use(authenticate);

// Profile & Organization
router.get("/auth/me", asyncHandler(apiController.getMe));
router.get("/organizations", validate({ query: orgQuery }), asyncHandler(apiController.listOrganizations));
router.get("/stats", asyncHandler(apiController.getDashboardStats));

// Admin routes
router.get("/admin/stats", authorize("ADMIN"), asyncHandler(apiController.getAdminStats));
router.get("/admin/users", authorize("ADMIN"), validate({ query: userQuery }), asyncHandler(apiController.listUsers));
router.post("/admin/users", authorize("ADMIN"), validate({ body: createUserBody }), asyncHandler(apiController.createUser));
router.patch("/admin/users/:id/status", authorize("ADMIN"), validate({ params: idParams, body: userStatusBody }), asyncHandler(apiController.updateUserStatus));
router.patch("/admin/users/:id/role", authorize("ADMIN"), validate({ params: idParams, body: userRoleBody }), asyncHandler(apiController.updateUserRole));
router.get("/admin/knowledge-documents", authorize("ADMIN"), asyncHandler(apiController.listKnowledgeDocuments));
router.get("/admin/knowledge-documents/:id", authorize("ADMIN"), validate({ params: idParams }), asyncHandler(apiController.getKnowledgeDocument));
router.post("/admin/knowledge-documents/:id/reindex", authorize("ADMIN"), validate({ params: idParams }), asyncHandler(apiController.reindexKnowledgeDocument));
router.get("/admin/audit-logs", authorize("ADMIN"), asyncHandler(apiController.listAuditLogs));

// Public Knowledge Base (Accessible to authenticated users for guidelines & policies)
router.get("/knowledge-documents", asyncHandler(apiController.listKnowledgeDocuments));
router.get("/knowledge-documents/:id", validate({ params: idParams }), asyncHandler(apiController.getKnowledgeDocument));

// Documents
router.get("/documents", validate({ query: documentQuery }), asyncHandler(apiController.listOwnedDocuments));
router.get("/documents/:id", validate({ params: idParams }), asyncHandler(apiController.getOwnedDocument));
router.get("/documents/:id/download", validate({ params: idParams }), asyncHandler(apiController.downloadDocument));
router.get("/documents/:id/file", validate({ params: idParams }), asyncHandler(apiController.downloadDocument));
router.post("/documents/upload", authorize(...SPECIALIST_ROLES), upload.single("file"), validate({ body: rootUploadDocumentBody }), asyncHandler(apiController.uploadDocumentForClaim));

// AI Services (Only permitted for authorized roles and denied claims)
router.post("/ai/run", authorize(...SPECIALIST_ROLES), validate({ body: aiRunBody }), asyncHandler(apiController.runAi));

// Claims Management
router.get("/claims", validate({ query: claimQuery }), asyncHandler(apiController.listClaims));
router.post("/claims", authorize(...SPECIALIST_ROLES), validate({ body: createClaimBody }), asyncHandler(apiController.createClaim));
router.get("/claims/:id", validate({ params: idParams }), asyncHandler(apiController.getClaim));
router.post("/claims/:id/review", authorize(...REVIEWER_ROLES), validate({ params: idParams, body: reviewClaimBody }), asyncHandler(apiController.reviewClaim));
router.post("/claims/:id/ai/analyze-rejection", authorize(...SPECIALIST_ROLES), validate({ params: idParams, body: analyzeRejectionBody }), asyncHandler(apiController.analyzeRejection));
router.post("/claims/:id/ai/analyze-denial", authorize(...SPECIALIST_ROLES), validate({ params: idParams, body: analyzeDenialBody }), asyncHandler(apiController.analyzeDenial));

// Claim Documents & Evidence Retrieval
router.get("/claims/:id/documents", validate({ params: idParams }), asyncHandler(apiController.listDocuments));
router.post("/claims/:id/documents", authorize(...SPECIALIST_ROLES), validate({ params: idParams }), asyncHandler(apiController.assertClaimOwnedForUpload), upload.single("file"), validate({ body: uploadDocumentBody }), asyncHandler(apiController.uploadDocument));
router.post("/claims/:id/documents/attach-predefined", authorize(...SPECIALIST_ROLES), validate({ params: idParams, body: attachPredefinedBody }), asyncHandler(apiController.attachPredefined));
router.post("/claims/:id/documents/:documentId/retry", authorize(...SPECIALIST_ROLES), validate({ params: documentParams }), asyncHandler(apiController.retryDocument));
router.post("/claims/:id/rag/retrieve", validate({ params: idParams, body: evidenceRetrieveBody }), asyncHandler(apiController.retrieveEvidence));
router.post("/claims/:id/evidence/retrieve", validate({ params: idParams, body: evidenceRetrieveBody }), asyncHandler(apiController.retrieveEvidence));
router.post("/claims/:id/appealletters/generate", authorize(...SPECIALIST_ROLES), validate({ params: idParams, body: generateBody }), asyncHandler(apiController.generateAppeal));

// Denials & Reference
router.get("/denials", validate({ query: denialQuery }), asyncHandler(apiController.listDenials));
router.get("/denials/:id", validate({ params: idParams }), asyncHandler(apiController.getDenial));
router.get("/denialreasons", validate({ query: pageQuery }), asyncHandler(apiController.listDenialReasons));
router.get("/reviewers", asyncHandler(apiController.listReviewers));
router.get("/evidences", validate({ query: evidenceQuery }), asyncHandler(apiController.listEvidence));
router.post("/evidences", authorize(...SPECIALIST_ROLES), validate({ body: createEvidenceBody }), asyncHandler(apiController.createEvidence));

// Appeal Letters & Adjudication Workflow
router.get("/appealletters", validate({ query: appealQuery }), asyncHandler(apiController.listAppealLetters));
router.get("/appealletters/:id", validate({ params: idParams }), asyncHandler(apiController.getAppealLetter));
router.patch("/appealletters/:id", authorize(...SPECIALIST_ROLES), validate({ params: idParams, body: updateAppealBody }), asyncHandler(apiController.updateAppealLetter));
router.post("/appealletters/:id/revise", authorize(...SPECIALIST_ROLES), validate({ params: idParams, body: reviseAppealBody }), asyncHandler(apiController.reviseAppealLetter));
router.post("/appealletters/:id/submit", authorize(...SPECIALIST_ROLES), validate({ params: idParams, body: submitAppealBody }), asyncHandler(apiController.submitAppealLetter));
router.post("/appealletters/:id/approve", authorize(...REVIEWER_ROLES), validate({ params: idParams, body: approveAppealBody }), asyncHandler(apiController.approveAppealLetter));
router.post("/appealletters/:id/reject", authorize(...REVIEWER_ROLES), validate({ params: idParams, body: rejectAppealBody }), asyncHandler(apiController.rejectAppealLetter));

export { router as apiRouter };
