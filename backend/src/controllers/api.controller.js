import { prisma } from "../db/prisma.js";
import { apiService } from "../services/api.service.js";
import { documentService } from "../services/document.service.js";
import { appealGenerationService } from "../services/appeal-generation.service.js";
import { appealReviewService } from "../services/appeal-review.service.js";

function publicData(value) {
  if (Array.isArray(value)) return value.map(publicData);
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "generationKey" && key !== "passwordHash")
    .map(([key, item]) => [key, publicData(item)]));
}

const send = (response, result, status = 200) => response.status(status).json({ data: publicData(result) });

export const apiController = {
  login: async (req, res) => send(res, await apiService.login(req.validated.body)),
  getMe: async (req, res) => send(res, await apiService.getMe(req.auth.id)),
  listOrganizations: async (req, res) => send(res, await apiService.listOrganizations(req.validated.query)),
  listClaims: async (req, res) => send(res, await apiService.listClaims(req.auth, req.validated.query)),
  getClaim: async (req, res) => send(res, await apiService.getClaim(req.auth, req.validated.params.id)),
  createClaim: async (req, res) => send(res, await apiService.createClaim(req.auth, req.validated.body), 201),
  reviewClaim: async (req, res) => send(res, await apiService.reviewClaim(req.auth, req.validated.params.id, req.validated.body)),
  listDenials: async (req, res) => send(res, await apiService.listDenials(req.auth, req.validated.query)),
  getDenial: async (req, res) => send(res, await apiService.getDenial(req.auth, req.validated.params.id)),
  listDenialReasons: async (req, res) => send(res, await apiService.listDenialReasons(req.validated.query)),
  listEvidence: async (req, res) => send(res, await apiService.listEvidence(req.auth, req.validated.query)),
  createEvidence: async (req, res) => send(res, await apiService.createEvidence(req.auth, req.validated.body), 201),
  assertClaimOwnedForUpload: async (req, _res, next) => {
    if (req.auth.role !== "ADMIN") {
      await documentService.assertOwnedClaim(req.auth.id, req.validated.params.id);
    }
    next();
  },
  listDocuments: async (req, res) => send(res, await documentService.listForClaim(req.auth, req.validated.params.id)),
  uploadDocument: async (req, res) => send(res, await documentService.upload(req.auth.id, req.validated.params.id, req.file, req.validated.body), 201),
  listOwnedDocuments: async (req, res) => send(res, await documentService.listForOwner(req.auth, req.validated.query)),
  getOwnedDocument: async (req, res) => send(res, await documentService.getForOwner(req.auth, req.validated.params.id)),
  downloadDocument: async (req, res) => {
    const { filePath, originalName, mimeType } = await documentService.getFilePath(req.auth, req.validated.params.id);
    res.setHeader("Content-Disposition", `inline; filename="${originalName}"`);
    res.setHeader("Content-Type", mimeType || "application/pdf");
    res.sendFile(filePath);
  },
  uploadDocumentForClaim: async (req, res) => {
    const { claimId, ...metadata } = req.validated.body;
    send(res, await documentService.upload(req.auth.id, claimId, req.file, metadata), 201);
  },
  attachPredefined: async (req, res) => send(res, await documentService.attachPredefined(req.auth, req.validated.params.id, req.validated.body), 201),
  retryDocument: async (req, res) => send(res, await documentService.retry(req.auth.id, req.validated.params.id, req.validated.params.documentId)),
  retrieveEvidence: async (req, res) => send(res, await documentService.retrieveForClaim(req.auth.id, req.validated.params.id, req.validated.body)),
  generateAppeal: async (req, res) => {
    const result = await appealGenerationService.generate(req.auth, req.validated.params.id, req.validated.body);
    send(res, result, result.saved ? 201 : 200);
  },
  runAi: async (req, res) => {
    const { claimId, ...input } = req.validated.body;
    const result = await appealGenerationService.generate(req.auth, claimId, input);
    send(res, result, result.saved ? 201 : 200);
  },
  analyzeRejection: async (req, res) => {
    const result = await appealGenerationService.analyzeRejection(req.auth, req.validated.params.id, req.validated.body || {});
    send(res, result);
  },
  analyzeDenial: async (req, res) => {
    const result = await appealGenerationService.analyzeDenial(req.auth, req.validated.params.id, req.validated.body || {});
    send(res, result);
  },
  listAppealLetters: async (req, res) => send(res, await apiService.listAppealLetters(req.auth, req.validated.query)),
  listReviewers: async (_req, res) => send(res, await apiService.listReviewers()),
  getAppealLetter: async (req, res) => send(res, await appealReviewService.get(req.auth, req.validated.params.id)),
  updateAppealLetter: async (req, res) => send(res, await appealReviewService.update(req.auth, req.validated.params.id, req.validated.body)),
  reviseAppealLetter: async (req, res) => send(res, await appealReviewService.revise(req.auth, req.validated.params.id, req.validated.body)),
  submitAppealLetter: async (req, res) => send(res, await appealReviewService.submit(req.auth, req.validated.params.id, req.validated.body)),
  approveAppealLetter: async (req, res) => send(res, await appealReviewService.approve(req.auth, req.validated.params.id, req.validated.body)),
  rejectAppealLetter: async (req, res) => send(res, await appealReviewService.reject(req.auth, req.validated.params.id, req.validated.body)),

  // Statistics APIs
  getDashboardStats: async (req, res) => send(res, await apiService.getDashboardStats(req.auth)),
  getAdminStats: async (_req, res) => send(res, await apiService.getAdminStats()),

  // Admin APIs
  listUsers: async (req, res) => send(res, await apiService.listUsers(req.validated.query)),
  createUser: async (req, res) => send(res, await apiService.createUser(req.validated.body), 201),
  updateUserStatus: async (req, res) => send(res, await apiService.updateUserStatus(req.validated.params.id, req.validated.body.active)),
  updateUserRole: async (req, res) => send(res, await apiService.updateUserRole(req.validated.params.id, req.validated.body.role)),
  listKnowledgeDocuments: async (req, res) => send(res, await apiService.listKnowledgeDocuments(req.query)),
  getKnowledgeDocument: async (req, res) => send(res, await apiService.getKnowledgeDocument(req.validated.params.id)),
  reindexKnowledgeDocument: async (req, res) => send(res, await apiService.reindexKnowledgeDocument(req.validated.params.id)),
  listAuditLogs: async (req, res) => send(res, await apiService.listAuditLogs(req.query)),

  health: async (_req, res) => {
    await prisma.$queryRawUnsafe("SELECT 1");
    res.json({ status: "ok", service: "backend", database: "ok" });
  }
};
