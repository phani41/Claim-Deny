import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { AppError, notFound } from "../errors/app-error.js";
import {
  userRepository, claimRepository, denialRepository, denialReasonRepository,
  evidenceRepository, appealLetterRepository, statsRepository, organizationRepository
} from "../data-access/repositories.js";

function pageResult(rows, total, page, limit, map = (row) => row) {
  return { data: rows.map(map), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

function amountView(record) {
  if (!record) return record;
  let amount = record.amount;
  if (amount && typeof amount === "object") {
    if (typeof amount.toFixed === "function") {
      amount = amount.toFixed(2);
    } else if (amount.d) {
      amount = Array.isArray(amount.d) ? String(amount.d.join("")) : String(amount.d);
    } else {
      amount = String(amount);
    }
  } else if (amount !== undefined && amount !== null) {
    amount = String(amount);
  }
  return { ...record, amount };
}

export const apiService = {
  async login({ email, password }) {
    const user = await userRepository.findByEmail(email);
    if (!user) throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    if (user.active === false) {
      throw new AppError(401, "ACCOUNT_DEACTIVATED", "Your account has been deactivated. Please contact an administrator.");
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    const token = jwt.sign({ role: user.role }, env.JWT_SECRET, {
      algorithm: "HS256", subject: user.id, expiresIn: env.JWT_EXPIRES_IN
    });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        active: user.active,
        organizationId: user.organizationId,
        organization: user.organization
      }
    };
  },

  async getMe(userId) {
    const user = await userRepository.findPublicIdentity(userId);
    if (!user) throw notFound("User");
    return { user };
  },

  async listOrganizations(query = {}) {
    const orgs = await organizationRepository.list({ type: query.type, active: true });
    return orgs;
  },

  async listClaims(user, query) {
    const [rows, total] = await claimRepository.listForUser(user, {
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      status: query.status,
      search: query.search
    });
    return pageResult(rows, total, query.page, query.limit, amountView);
  },

  async getClaim(user, id) {
    const row = await claimRepository.findForUser(id, user);
    if (!row) throw notFound("Claim");
    return amountView(row);
  },

  async createClaim(user, input) {
    // Validate insurance organization
    let insuranceOrg = null;
    if (input.insuranceOrganizationId) {
      insuranceOrg = await organizationRepository.findById(input.insuranceOrganizationId);
      if (!insuranceOrg || insuranceOrg.type !== "INSURANCE_COMPANY" || !insuranceOrg.active) {
        throw new AppError(400, "INVALID_INSURANCE_COMPANY", "The selected organization is not an active insurance company.");
      }
    } else if (input.payerName) {
      insuranceOrg = await organizationRepository.findByName(input.payerName);
    }

    if (!insuranceOrg) {
      // Find first available active insurance company as fallback
      const insList = await organizationRepository.list({ type: "INSURANCE_COMPANY" });
      if (insList.length > 0) insuranceOrg = insList[0];
    }

    // Determine hospital organization
    let hospitalOrgId = user.organizationId;
    let hospitalName = input.hospitalName;
    if (hospitalOrgId) {
      const hosp = await organizationRepository.findById(hospitalOrgId);
      if (hosp) hospitalName = hosp.name;
    }

    // Support idempotent claim submission and retry: check if claim already exists
    const existingClaim = await prisma.claim.findFirst({
      where: { ownerId: user.id, claimNumber: input.claimNumber }
    });

    if (existingClaim) {
      if (existingClaim.status === "SUBMITTED") {
        const updated = await prisma.claim.update({
          where: { id: existingClaim.id },
          data: {
            patientName: input.patientName || existingClaim.patientName,
            hospitalName: hospitalName || existingClaim.hospitalName,
            payerName: insuranceOrg ? insuranceOrg.name : (input.payerName || existingClaim.payerName),
            policyNumber: input.policyNumber || existingClaim.policyNumber,
            diagnosisCode: input.diagnosisCode || existingClaim.diagnosisCode,
            procedureCode: input.procedureCode || existingClaim.procedureCode,
            treatmentDescription: input.treatmentDescription || existingClaim.treatmentDescription,
            hospitalOrganizationId: hospitalOrgId || existingClaim.hospitalOrganizationId,
            insuranceOrganizationId: insuranceOrg ? insuranceOrg.id : existingClaim.insuranceOrganizationId,
            serviceDate: new Date(input.serviceDate),
            amount: new Prisma.Decimal(input.amount),
            currency: input.currency || "INR"
          }
        });
        return amountView(updated);
      } else {
        throw new AppError(
          409,
          "CLAIM_ALREADY_EXISTS",
          `Claim ${input.claimNumber} already exists with status ${existingClaim.status}. Please enter a unique claim number or manage evidence in the Evidence Workspace.`
        );
      }
    }

    const row = await claimRepository.create(user.id, {
      claimNumber: input.claimNumber,
      patientName: input.patientName || null,
      hospitalName: hospitalName || null,
      payerName: insuranceOrg ? insuranceOrg.name : input.payerName,
      policyNumber: input.policyNumber || null,
      diagnosisCode: input.diagnosisCode || null,
      procedureCode: input.procedureCode || null,
      treatmentDescription: input.treatmentDescription || null,
      hospitalOrganizationId: hospitalOrgId || null,
      insuranceOrganizationId: insuranceOrg ? insuranceOrg.id : null,
      serviceDate: new Date(input.serviceDate),
      amount: new Prisma.Decimal(input.amount),
      currency: input.currency || "INR",
      status: "SUBMITTED"
    });
    return amountView(row);
  },

  async reviewClaim(user, claimId, input) {
    const isAdmin = user.role === "ADMIN";
    const isReviewer = ["COMPLIANCE_REVIEWER", "REVIEWER"].includes(user.role);
    if (!isAdmin && !isReviewer) {
      throw new AppError(403, "FORBIDDEN", "Only compliance reviewers can adjudicate claims.");
    }

    const claim = await claimRepository.findOwner(claimId);
    if (!claim) throw notFound("Claim");

    if (claim.status === "APPROVED") {
      throw new AppError(409, "ALREADY_APPROVED", "This claim has already been approved and finalized.");
    }

    if (!isAdmin && user.organizationId && claim.insuranceOrganizationId && claim.insuranceOrganizationId !== user.organizationId) {
      throw new AppError(403, "FORBIDDEN", "You are not authorized to review claims routed to another insurance organization.");
    }

    if (input.decision === "DENIED") {
      if (!input.denialCode || !input.denialCode.trim()) {
        throw new AppError(400, "DENIAL_CODE_REQUIRED", "Denial code is required when denying a claim.");
      }
      if (!input.denialExplanation || !input.denialExplanation.trim()) {
        throw new AppError(400, "DENIAL_EXPLANATION_REQUIRED", "Denial explanation is required when denying a claim.");
      }
    }

    const result = await claimRepository.addClaimReview(claimId, user.id, input);
    return {
      message: `Claim successfully ${input.decision.toLowerCase()}.`,
      claim: amountView(result.claim),
      review: result.review
    };
  },

  async listDenials(user, query) {
    const isAdmin = user.role === "ADMIN";

    // Auto-heal any orphaned denied claims so they are immediately actionable in AI Denial Analysis
    try {
      const orphans = await prisma.claim.findMany({
        where: {
          status: "DENIED",
          denials: { none: {} }
        },
        take: 10
      });
      for (const orphan of orphans) {
        await prisma.denial.create({
          data: {
            claimId: orphan.id,
            denialReasonCode: "DOC-01",
            reasonText: "Claim denied: Supporting clinical documentation required by insurer policy.",
            denialDate: orphan.updatedAt || new Date(),
            status: "OPEN"
          }
        }).catch(() => null);
      }
    } catch {
      // Safe fallback if table busy
    }

    const [rows, total] = await denialRepository.listForOwner(user.id, {
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      isAdmin,
      user,
      claimId: query.claimId,
      status: query.status
    });
    return pageResult(rows, total, query.page, query.limit);
  },

  async getDenial(user, id) {
    const isAdmin = user.role === "ADMIN";
    const row = await denialRepository.findForOwner(id, user.id, { isAdmin, user });
    if (!row) throw notFound("Denial");
    return row;
  },

  async listDenialReasons(query) {
    const [rows, total] = await denialReasonRepository.list({
      skip: (query.page - 1) * query.limit, take: query.limit
    });
    return pageResult(rows, total, query.page, query.limit);
  },

  async listReviewers() {
    return { data: await userRepository.listReviewers() };
  },

  async listEvidence(user, query) {
    const isAdmin = user.role === "ADMIN";
    const [rows, total] = await evidenceRepository.listForOwner(user.id, {
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      claimId: query.claimId,
      isAdmin,
      user
    });
    return pageResult(rows, total, query.page, query.limit);
  },

  async createEvidence(user, input) {
    const isAdmin = user.role === "ADMIN";
    const claim = await claimRepository.findOwner(input.claimId);
    if (!claim) throw notFound("Claim");

    if (!isAdmin) {
      if (user.organizationId && claim.hospitalOrganizationId) {
        if (claim.hospitalOrganizationId !== user.organizationId && claim.ownerId !== user.id) {
          throw notFound("Claim");
        }
      } else if (claim.ownerId !== user.id) {
        throw notFound("Claim");
      }
    }

    return evidenceRepository.create({
      claimId: claim.id,
      createdById: user.id,
      type: input.type,
      sourceLabel: input.sourceLabel,
      summary: input.summary,
      sourceDate: input.sourceDate ? new Date(input.sourceDate) : null
    });
  },

  async listAppealLetters(user, query) {
    const [rows, total] = await appealLetterRepository.listVisibleTo(user, {
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      status: query.status,
      claimId: query.claimId
    });
    return pageResult(rows, total, query.page, query.limit, (row) => ({
      ...row,
      claim: row.claim ? amountView(row.claim) : row.claim
    }));
  },

  async getDashboardStats(user) {
    return statsRepository.getStatsForUser(user);
  },

  // Admin APIs
  async listUsers(query) {
    const result = await userRepository.listAll({
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      search: query.search,
      role: query.role
    });
    return pageResult(result.data, result.total, query.page, query.limit);
  },

  async createUser(input) {
    const existing = await userRepository.findByEmail(input.email);
    if (existing) {
      throw new AppError(409, "USER_EXISTS", "A user with this email address already exists.");
    }
    const passwordHash = await bcrypt.hash(input.password, 12);
    return userRepository.create({
      email: input.email,
      displayName: input.displayName,
      passwordHash,
      role: input.role || "BILLING_SPECIALIST",
      organizationId: input.organizationId || null,
      active: input.active !== undefined ? input.active : true
    });
  },

  async updateUserStatus(id, active) {
    const user = await userRepository.findPublicIdentity(id);
    if (!user) throw notFound("User");
    return userRepository.update(id, { active });
  },

  async updateUserRole(id, role) {
    const user = await userRepository.findPublicIdentity(id);
    if (!user) throw notFound("User");
    return userRepository.update(id, { role });
  },

  async getAdminStats() {
    return statsRepository.getAdminStats();
  },

  async listKnowledgeDocuments(query = {}) {
    const where = {};
    if (query.category) where.category = query.category;
    if (query.scope) where.scope = query.scope;
    if (query.organizationId) where.organizationId = query.organizationId;
    return prisma.knowledgeDocument.findMany({
      where,
      include: { organization: { select: { id: true, name: true, type: true } } },
      orderBy: [{ category: "asc" }, { title: "asc" }]
    });
  },

  async getKnowledgeDocument(id) {
    const doc = await prisma.knowledgeDocument.findUnique({
      where: { id },
      include: { organization: { select: { id: true, name: true, type: true } } }
    });
    if (!doc) throw notFound("KnowledgeDocument");
    return doc;
  },

  async reindexKnowledgeDocument(id) {
    const doc = await prisma.knowledgeDocument.findUnique({ where: { id } });
    if (!doc) throw notFound("KnowledgeDocument");
    return prisma.knowledgeDocument.update({
      where: { id },
      data: { indexedAt: new Date(), indexingStatus: "INDEXED" }
    });
  },

  async listAuditLogs({ limit = 50, entityType, action } = {}) {
    const where = {};
    if (entityType) where.entityType = entityType;
    if (action) where.action = action;
    return prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100)
    });
  },

  async logAudit(userId, action, entityType, entityId, details = null) {
    try {
      return await prisma.auditLog.create({
        data: {
          userId: userId || null,
          action,
          entityType,
          entityId,
          details: details ? (typeof details === "string" ? details : JSON.stringify(details)) : null
        }
      });
    } catch {
      // Non-blocking for audit logging
    }
  }
};
