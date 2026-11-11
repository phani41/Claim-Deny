import { prisma } from "../db/prisma.js";

export const organizationRepository = {
  findById: (id) => prisma.organization.findUnique({ where: { id } }),
  findByName: (name) => prisma.organization.findUnique({ where: { name } }),
  list: async ({ type, active = true } = {}) => {
    return prisma.organization.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(active !== undefined ? { active } : {})
      },
      orderBy: { name: "asc" }
    });
  }
};

export const userRepository = {
  findByEmail: (email) => prisma.user.findUnique({
    where: { email },
    include: { organization: { select: { id: true, name: true, type: true } } }
  }),
  findPublicIdentity: (id) => prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      active: true,
      organizationId: true,
      organization: { select: { id: true, name: true, type: true } }
    }
  }),
  listReviewers: () => prisma.user.findMany({
    where: { role: { in: ["REVIEWER", "COMPLIANCE_REVIEWER"] }, active: true },
    select: {
      id: true,
      displayName: true,
      email: true,
      role: true,
      organizationId: true,
      organization: { select: { id: true, name: true } }
    },
    orderBy: { displayName: "asc" }
  }),
  findReviewer: (id) => prisma.user.findFirst({
    where: { id, role: { in: ["REVIEWER", "COMPLIANCE_REVIEWER"] }, active: true },
    select: { id: true, displayName: true, email: true, organizationId: true }
  }),
  listAll: async ({ skip = 0, take = 50, search, role }) => {
    const where = {
      ...(role ? { role } : {}),
      ...(search ? {
        OR: [
          { displayName: { contains: search } },
          { email: { contains: search } }
        ]
      } : {})
    };
    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where, skip, take, orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          active: true,
          organizationId: true,
          organization: { select: { id: true, name: true, type: true } },
          createdAt: true,
          updatedAt: true
        }
      }),
      prisma.user.count({ where })
    ]);
    return { data, total };
  },
  create: (data) => prisma.user.create({
    data,
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      active: true,
      organizationId: true,
      organization: { select: { id: true, name: true, type: true } },
      createdAt: true
    }
  }),
  update: (id, data) => prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      active: true,
      organizationId: true,
      organization: { select: { id: true, name: true, type: true } },
      updatedAt: true
    }
  })
};

function buildClaimUserWhere(user) {
  if (!user || user.role === "ADMIN") return {};
  if (user.role === "BILLING_SPECIALIST" || user.role === "PROVIDER") {
    if (user.organizationId) {
      return {
        OR: [
          { hospitalOrganizationId: user.organizationId },
          { ownerId: user.id }
        ]
      };
    }
    return { ownerId: user.id };
  }
  if (user.role === "COMPLIANCE_REVIEWER" || user.role === "REVIEWER") {
    if (user.organizationId) {
      return {
        OR: [
          { insuranceOrganizationId: user.organizationId },
          { insuranceOrganizationId: null },
          { insuranceOrganizationId: "" },
          { appealLetters: { some: { reviewerId: user.id } } },
          { claimReviews: { some: { reviewerId: user.id } } }
        ]
      };
    }
    return {
      OR: [
        { appealLetters: { some: { reviewerId: user.id } } },
        { claimReviews: { some: { reviewerId: user.id } } }
      ]
    };
  }
  return { ownerId: user.id };
}

export const claimRepository = {
  listForUser(user, { skip = 0, take = 50, status, search }) {
    const baseAuth = buildClaimUserWhere(user);
    const searchFilter = search ? {
      OR: [
        { claimNumber: { contains: search } },
        { patientName: { contains: search } },
        { hospitalName: { contains: search } },
        { payerName: { contains: search } },
        { policyNumber: { contains: search } }
      ]
    } : {};

    const where = {
      ...baseAuth,
      ...(status ? { status } : {}),
      ...searchFilter
    };

    return Promise.all([
      prisma.claim.findMany({
        where,
        skip,
        take,
        orderBy: [{ serviceDate: "desc" }, { id: "asc" }],
        include: {
          hospitalOrganization: { select: { id: true, name: true, type: true } },
          insuranceOrganization: { select: { id: true, name: true, type: true } },
          denials: {
            include: { denialReason: { select: { code: true, title: true } } },
            orderBy: { createdAt: "desc" }
          },
          claimReviews: {
            include: { reviewer: { select: { id: true, displayName: true, email: true } } },
            orderBy: { createdAt: "desc" }
          },
          appealLetters: {
            select: { id: true, status: true, revisionNumber: true, reviewerComment: true, updatedAt: true }
          },
          _count: { select: { denials: true, evidences: true, appealLetters: true, documents: true } }
        }
      }),
      prisma.claim.count({ where })
    ]);
  },

  listForOwner(userId, opts) {
    // Adapter for backward compatibility
    const user = { id: userId, role: opts.isAdmin ? "ADMIN" : "BILLING_SPECIALIST" };
    return this.listForUser(user, opts);
  },

  findForUser(id, user) {
    const baseAuth = buildClaimUserWhere(user);
    const where = {
      id,
      ...baseAuth
    };

    return prisma.claim.findFirst({
      where,
      include: {
        hospitalOrganization: { select: { id: true, name: true, type: true } },
        insuranceOrganization: { select: { id: true, name: true, type: true } },
        denials: {
          include: { denialReason: { select: { code: true, title: true } } },
          orderBy: { createdAt: "desc" }
        },
        claimReviews: {
          include: { reviewer: { select: { id: true, displayName: true, email: true } } },
          orderBy: { createdAt: "desc" }
        },
        documents: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            claimId: true,
            type: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            status: true,
            pageCount: true,
            createdAt: true
          }
        },
        evidences: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            claimId: true,
            type: true,
            sourceLabel: true,
            summary: true,
            sourceDate: true,
            documentId: true,
            sourceReference: true,
            pageNumber: true,
            sectionName: true,
            createdAt: true,
            updatedAt: true,
            document: { select: { originalName: true, status: true } }
          }
        },
        appealLetters: {
          orderBy: { createdAt: "desc" },
          include: {
            author: { select: { id: true, displayName: true, email: true } },
            reviewer: { select: { id: true, displayName: true, email: true } },
            appealReviews: {
              include: { reviewer: { select: { id: true, displayName: true } } },
              orderBy: { createdAt: "desc" }
            }
          }
        },
        _count: { select: { appealLetters: true, evidences: true, documents: true, denials: true } }
      }
    });
  },

  findForOwner(id, userId, { isAdmin = false, isReviewer = false } = {}) {
    // Adapter for backward compatibility
    const user = {
      id: userId,
      role: isAdmin ? "ADMIN" : (isReviewer ? "COMPLIANCE_REVIEWER" : "BILLING_SPECIALIST")
    };
    return this.findForUser(id, user);
  },

  findOwner(id) {
    return prisma.claim.findUnique({
      where: { id },
      select: {
        id: true,
        ownerId: true,
        hospitalOrganizationId: true,
        insuranceOrganizationId: true,
        status: true,
        claimNumber: true
      }
    });
  },

  create(ownerId, data) {
    return prisma.claim.create({
      data: {
        ...data,
        currency: data.currency || "INR",
        status: data.status || "SUBMITTED",
        ownerId
      },
      include: {
        hospitalOrganization: { select: { id: true, name: true, type: true } },
        insuranceOrganization: { select: { id: true, name: true, type: true } },
        _count: { select: { denials: true, evidences: true, appealLetters: true, documents: true } }
      }
    });
  },

  update(id, data) {
    return prisma.claim.update({ where: { id }, data });
  },

  async addClaimReview(claimId, reviewerId, { decision, denialCode, denialExplanation, reviewComments }) {
    return prisma.$transaction(async (tx) => {
      const review = await tx.claimReview.create({
        data: {
          claimId,
          reviewerId,
          decision,
          denialCode: decision === "DENIED" ? denialCode : null,
          denialExplanation: decision === "DENIED" ? denialExplanation : null,
          reviewComments: reviewComments || null
        }
      });

      const updatedClaim = await tx.claim.update({
        where: { id: claimId },
        data: { status: decision }
      });

      if (decision === "DENIED") {
        const targetCode = denialCode || "DOC-01";
        // Ensure standard DenialReason exists or fallback
        const existingReason = await tx.denialReason.findUnique({ where: { code: targetCode } });
        const validCode = existingReason ? targetCode : "DOC-01";
        const combinedReason = reviewComments
          ? (denialExplanation ? `${denialExplanation} — Reviewer Comment: ${reviewComments}` : reviewComments)
          : (denialExplanation || `Claim denied under code ${validCode}`);

        const existingDenial = await tx.denial.findFirst({ where: { claimId } });
        if (existingDenial) {
          await tx.denial.update({
            where: { id: existingDenial.id },
            data: {
              denialReasonCode: validCode,
              reasonText: combinedReason,
              denialDate: new Date(),
              status: "OPEN"
            }
          });
        } else {
          await tx.denial.create({
            data: {
              claimId,
              denialReasonCode: validCode,
              reasonText: combinedReason,
              denialDate: new Date(),
              status: "OPEN"
            }
          });
        }
      } else if (decision === "APPROVED") {
        await tx.denial.updateMany({
          where: { claimId, status: { in: ["OPEN", "APPEALED"] } },
          data: { status: "RESOLVED" }
        });
        await tx.appealLetter.updateMany({
          where: { claimId, status: { in: ["DRAFT", "REQUIRES_CORRECTION", "IN_REVIEW", "SUBMITTED_FOR_REVIEW", "SUBMITTED"] } },
          data: {
            status: "APPROVED",
            reviewerId,
            reviewedAt: new Date()
          }
        });
      }

      return { review, claim: updatedClaim };
    });
  }
};

export const denialRepository = {
  listForClaim(claimId) {
    return prisma.denial.findMany({
      where: { claimId },
      include: {
        denialReason: { include: { evidenceRules: true } }
      }
    });
  },
  listForOwner(userId, { skip, take, isAdmin = false, user, claimId, status } = {}) {
    const authWhere = user ? buildClaimUserWhere(user) : (isAdmin ? {} : { claim: { ownerId: userId } });
    const where = {
      ...(claimId ? { claimId } : {}),
      ...(status && status !== "ALL"
        ? { status }
        : { status: { in: ["OPEN", "APPEALED"] } }),
      claim: {
        ...authWhere,
        status: { in: ["DENIED", "APPEAL_DRAFT", "SUBMITTED_FOR_REVIEW", "UNDER_REVIEW"] }
      }
    };
    return Promise.all([
      prisma.denial.findMany({
        where, skip, take, orderBy: { createdAt: "desc" },
        include: {
          denialReason: { include: { evidenceRules: true } },
          claim: {
            select: {
              id: true,
              claimNumber: true,
              patientName: true,
              hospitalName: true,
              payerName: true,
              amount: true,
              currency: true,
              status: true,
              hospitalOrganizationId: true,
              insuranceOrganizationId: true
            }
          }
        }
      }),
      prisma.denial.count({ where })
    ]);
  },
  findForOwner(id, userId, { isAdmin = false, user } = {}) {
    const authWhere = user ? buildClaimUserWhere(user) : (isAdmin ? {} : { claim: { ownerId: userId } });
    const where = { id, ...(user ? { claim: authWhere } : authWhere) };
    return prisma.denial.findFirst({
      where,
      include: {
        denialReason: { include: { evidenceRules: true } },
        claim: {
          select: {
            id: true,
            claimNumber: true,
            patientName: true,
            hospitalName: true,
            payerName: true,
            amount: true,
            currency: true,
            hospitalOrganizationId: true,
            insuranceOrganizationId: true
          }
        }
      }
    });
  }
};

export const denialReasonRepository = {
  list({ skip, take }) {
    const where = { active: true };
    return Promise.all([
      prisma.denialReason.findMany({
        where, skip, take, orderBy: { code: "asc" },
        include: { evidenceRules: { orderBy: { evidenceType: "asc" } } }
      }),
      prisma.denialReason.count({ where })
    ]);
  }
};

export const evidenceRepository = {
  listForOwner(userId, { skip, take, claimId, isAdmin = false, user }) {
    let claimWhere = {};
    if (user) {
      claimWhere = buildClaimUserWhere(user);
    } else if (!isAdmin) {
      claimWhere = { ownerId: userId };
    }

    const where = {
      claim: claimWhere,
      ...(claimId ? { claimId } : {})
    };

    return Promise.all([
      prisma.evidence.findMany({
        where, skip, take, orderBy: { createdAt: "desc" },
        select: {
          id: true, claimId: true, createdById: true, type: true, sourceLabel: true,
          summary: true, sourceDate: true, documentId: true, sourceReference: true,
          pageNumber: true, sectionName: true, createdAt: true, updatedAt: true,
          claim: { select: { id: true, claimNumber: true, patientName: true } },
          document: { select: { id: true, originalName: true, status: true } }
        }
      }),
      prisma.evidence.count({ where })
    ]);
  },
  create(data) {
    return prisma.evidence.create({
      data,
      include: { claim: { select: { id: true, claimNumber: true, patientName: true } } }
    });
  },
  createExtractedSegments(documentId, segments) {
    return prisma.$transaction(async (tx) => {
      const rows = [];
      for (const segment of segments) {
        rows.push(await tx.evidence.create({ data: { ...segment, documentId } }));
      }
      return rows;
    });
  },
  replaceExtractedSegments(documentId, segments) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.evidence.findMany({ where: { documentId }, select: { id: true } });
      const ids = current.map((row) => row.id);
      if (ids.length) {
        const cited = await tx.appealCitation.count({ where: { evidenceId: { in: ids } } });
        if (cited) throw new Error("CITED_DOCUMENT_CANNOT_BE_REPROCESSED");
        await tx.evidence.deleteMany({ where: { documentId } });
      }
      const rows = [];
      for (const segment of segments) rows.push(await tx.evidence.create({ data: { ...segment, documentId } }));
      return rows;
    });
  },
  findFirstForDocument(documentId) {
    return prisma.evidence.findFirst({ where: { documentId }, orderBy: { createdAt: "asc" }, select: { sourceDate: true } });
  },
  findByIdsForClaim(claimId, ids) {
    return prisma.evidence.findMany({
      where: { claimId, id: { in: ids } },
      include: { document: true }
    });
  }
};

export const documentRepository = {
  create: (data) => prisma.document.create({ data }),
  update: (id, data) => prisma.document.update({ where: { id }, data }),
  delete: (id) => prisma.document.delete({ where: { id } }),
  findForOwner(id, userId, { isAdmin = false, user } = {}) {
    const claimWhere = user ? buildClaimUserWhere(user) : (isAdmin ? {} : { ownerId: userId });
    return prisma.document.findFirst({ where: { id, claim: claimWhere } });
  },
  listForClaim(claimId, userId, { skip = 0, take = 50, isAdmin = false, user } = {}) {
    const claimWhere = user ? buildClaimUserWhere(user) : (isAdmin ? {} : { ownerId: userId });
    const where = { claimId, claim: claimWhere };
    return Promise.all([
      prisma.document.findMany({
        where, skip, take, orderBy: { createdAt: "desc" },
        select: {
          id: true, claimId: true, type: true, originalName: true, mimeType: true,
          sizeBytes: true, status: true, pageCount: true, processingError: true,
          createdAt: true, updatedAt: true, _count: { select: { evidences: true } }
        }
      }),
      prisma.document.count({ where })
    ]);
  },
  listForOwner(userId, { skip = 0, take = 50, claimId, isAdmin = false, user } = {}) {
    const claimWhere = user ? buildClaimUserWhere(user) : (isAdmin ? {} : { ownerId: userId });
    const where = {
      claim: claimWhere,
      ...(claimId ? { claimId } : {})
    };
    return Promise.all([
      prisma.document.findMany({
        where, skip, take, orderBy: { createdAt: "desc" },
        select: {
          id: true, claimId: true, type: true, originalName: true, mimeType: true,
          sizeBytes: true, status: true, pageCount: true, processingError: true,
          createdAt: true, updatedAt: true, _count: { select: { evidences: true } }
        }
      }),
      prisma.document.count({ where })
    ]);
  }
};

function buildAppealUserWhere(user) {
  if (!user || user.role === "ADMIN") return {};
  if (user.role === "BILLING_SPECIALIST" || user.role === "PROVIDER") {
    if (user.organizationId) {
      return {
        claim: {
          OR: [
            { hospitalOrganizationId: user.organizationId },
            { ownerId: user.id }
          ]
        }
      };
    }
    return { claim: { ownerId: user.id } };
  }
  if (user.role === "COMPLIANCE_REVIEWER" || user.role === "REVIEWER") {
    if (user.organizationId) {
      return {
        claim: {
          insuranceOrganizationId: user.organizationId
        }
      };
    }
    return {
      OR: [
        { reviewerId: user.id },
        { appealReviews: { some: { reviewerId: user.id } } }
      ]
    };
  }
  return { claim: { ownerId: user.id } };
}

export const appealLetterRepository = {
  includeDetail: {
    claim: {
      select: {
        id: true,
        claimNumber: true,
        patientName: true,
        hospitalName: true,
        payerName: true,
        amount: true,
        currency: true,
        serviceDate: true,
        status: true,
        hospitalOrganizationId: true,
        insuranceOrganizationId: true,
        hospitalOrganization: { select: { id: true, name: true } },
        insuranceOrganization: { select: { id: true, name: true } }
      }
    },
    author: { select: { id: true, displayName: true, email: true, organizationId: true } },
    reviewer: { select: { id: true, displayName: true, email: true, organizationId: true } },
    citations: {
      orderBy: { createdAt: "asc" },
      include: {
        evidence: {
          select: {
            id: true, claimId: true, type: true, sourceLabel: true, summary: true, sourceDate: true,
            documentId: true, sourceReference: true, pageNumber: true, sectionName: true,
            document: { select: { id: true, claimId: true, originalName: true, status: true } }
          }
        }
      }
    },
    appealReviews: {
      orderBy: { createdAt: "desc" },
      include: {
        reviewer: { select: { id: true, displayName: true, email: true } }
      }
    }
  },

  listVisibleTo(userIdOrUser, { skip, take, isAdmin = false, status, claimId } = {}) {
    const user = typeof userIdOrUser === "object" ? userIdOrUser : { id: userIdOrUser, role: isAdmin ? "ADMIN" : "BILLING_SPECIALIST" };
    const authFilter = buildAppealUserWhere(user);

    const where = {
      ...authFilter,
      ...(status ? { status } : {}),
      ...(claimId ? { claimId } : {})
    };

    return Promise.all([
      prisma.appealLetter.findMany({
        where, skip, take, orderBy: { createdAt: "desc" },
        include: this.includeDetail
      }),
      prisma.appealLetter.count({ where })
    ]);
  },

  findVisibleById(id, userIdOrUser, { isAdmin = false } = {}) {
    const user = typeof userIdOrUser === "object" ? userIdOrUser : { id: userIdOrUser, role: isAdmin ? "ADMIN" : "BILLING_SPECIALIST" };
    const authFilter = buildAppealUserWhere(user);

    const where = {
      id,
      ...authFilter
    };

    return prisma.appealLetter.findFirst({
      where,
      include: this.includeDetail
    });
  },

  findByGenerationKey(generationKey) {
    return prisma.appealLetter.findUnique({ where: { generationKey }, include: this.includeDetail });
  },

  async updateDraft({ id, claimId, expectedUpdatedAt, content, reviewerId }) {
    const where = {
      id,
      claimId,
      status: { in: ["DRAFT", "REQUIRES_CORRECTION", "IN_REVIEW", "REJECTED"] },
      ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {})
    };
    const data = {
      ...(content !== undefined ? { content, grounded: false, status: "DRAFT" } : {})
    };
    if (reviewerId !== undefined) data.reviewerId = reviewerId;
    const changed = await prisma.appealLetter.updateMany({ where, data });
    if (changed.count !== 1) return null;
    return prisma.appealLetter.findUnique({ where: { id }, include: this.includeDetail });
  },

  async revise({ id, authorId, content, expectedUpdatedAt }) {
    const existing = await prisma.appealLetter.findUnique({ where: { id } });
    if (!existing) return null;

    const where = {
      id,
      status: { in: ["DRAFT", "REQUIRES_CORRECTION", "REJECTED"] },
      ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {})
    };

    const changed = await prisma.appealLetter.updateMany({
      where,
      data: {
        status: "DRAFT",
        revisionNumber: existing.revisionNumber + 1,
        reviewerComment: null,
        ...(content !== undefined ? { content, grounded: false } : {})
      }
    });
    if (changed.count !== 1) return null;
    return prisma.appealLetter.findUnique({ where: { id }, include: this.includeDetail });
  },

  async submitForReview({ id, reviewerId, expectedUpdatedAt }) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appealLetter.findUnique({ where: { id } });
      if (!existing) return null;

      const where = {
        id,
        status: { in: ["DRAFT", "REQUIRES_CORRECTION", "REJECTED"] },
        ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {})
      };
      const changed = await tx.appealLetter.updateMany({
        where,
        data: {
          status: "SUBMITTED_FOR_REVIEW",
          submittedAt: new Date(),
          ...(reviewerId ? { reviewerId } : {})
        }
      });
      if (changed.count !== 1) return null;

      // Update underlying claim to SUBMITTED_FOR_REVIEW
      await tx.claim.update({
        where: { id: existing.claimId },
        data: { status: "SUBMITTED_FOR_REVIEW" }
      });

      // Update any open denials to APPEALED
      await tx.denial.updateMany({
        where: { claimId: existing.claimId, status: "OPEN" },
        data: { status: "APPEALED" }
      });

      return tx.appealLetter.findUnique({ where: { id }, include: this.includeDetail });
    });
  },

  async approve({ id, reviewerId, reviewerComment, expectedUpdatedAt }) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appealLetter.findUnique({ where: { id } });
      if (!existing) return null;

      const where = {
        id,
        status: { in: ["DRAFT", "REQUIRES_CORRECTION", "IN_REVIEW", "SUBMITTED_FOR_REVIEW", "SUBMITTED"] },
        ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {})
      };

      const changed = await tx.appealLetter.updateMany({
        where,
        data: {
          status: "APPROVED",
          reviewerId,
          reviewedAt: new Date()
        }
      });
      if (changed.count !== 1) return null;

      await tx.appealReview.create({
        data: {
          appealLetterId: id,
          reviewerId,
          decision: "APPROVED",
          reviewerComment: reviewerComment || "Appeal letter approved after compliance verification."
        }
      });

      // Update the underlying claim to APPROVED so the approval reflects on the biller side
      await tx.claim.update({
        where: { id: existing.claimId },
        data: { status: "APPROVED" }
      });

      // Update all appeal letters for this claim to APPROVED so superseded revisions do not linger as active rejections
      await tx.appealLetter.updateMany({
        where: { claimId: existing.claimId },
        data: { status: "APPROVED" }
      });

      // Update open and appealed denials to RESOLVED
      await tx.denial.updateMany({
        where: { claimId: existing.claimId, status: { in: ["OPEN", "APPEALED"] } },
        data: { status: "RESOLVED" }
      });

      return tx.appealLetter.findUnique({ where: { id }, include: this.includeDetail });
    });
  },

  async reject({ id, reviewerId, reviewerComment, expectedUpdatedAt }) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appealLetter.findUnique({ where: { id } });
      if (!existing) return null;

      const where = {
        id,
        status: { in: ["DRAFT", "REQUIRES_CORRECTION", "IN_REVIEW", "SUBMITTED_FOR_REVIEW", "SUBMITTED"] },
        ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {})
      };

      const changed = await tx.appealLetter.updateMany({
        where,
        data: {
          status: "REJECTED",
          reviewerId,
          reviewerComment,
          reviewedAt: new Date()
        }
      });
      if (changed.count !== 1) return null;

      await tx.appealReview.create({
        data: {
          appealLetterId: id,
          reviewerId,
          decision: "REJECTED",
          reviewerComment
        }
      });

      // Update the underlying claim to DENIED so the biller side shows it as denied
      await tx.claim.update({
        where: { id: existing.claimId },
        data: { status: "DENIED" }
      });

      // Keep or reopen denial as OPEN with reviewer feedback so biller can analyse and upload new evidence
      const existingDenial = await tx.denial.findFirst({ where: { claimId: existing.claimId } });
      if (existingDenial) {
        await tx.denial.update({
          where: { id: existingDenial.id },
          data: {
            status: "OPEN",
            reasonText: reviewerComment ? `Appeal Rejected by Reviewer: ${reviewerComment}` : existingDenial.reasonText
          }
        });
      } else {
        await tx.denial.create({
          data: {
            claimId: existing.claimId,
            denialReasonCode: "DOC-01",
            reasonText: reviewerComment ? `Appeal Rejected by Reviewer: ${reviewerComment}` : "Appeal rejected by compliance reviewer",
            denialDate: new Date(),
            status: "OPEN"
          }
        });
      }

      return tx.appealLetter.findUnique({ where: { id }, include: this.includeDetail });
    });
  },

  createWithCitations(data, citations) {
    const uniqueCitations = [];
    const seenEvidenceIds = new Set();
    for (const citation of (citations || [])) {
      if (citation?.evidenceId && !seenEvidenceIds.has(citation.evidenceId)) {
        seenEvidenceIds.add(citation.evidenceId);
        uniqueCitations.push(citation);
      }
    }
    return prisma.appealLetter.create({
      data: {
        ...data,
        citations: { create: uniqueCitations.map((citation) => ({ evidenceId: citation.evidenceId, excerpt: citation.excerpt })) }
      },
      include: this.includeDetail
    });
  }
};

export const statsRepository = {
  async getStatsForUser(user) {
    if (!user || user.role === "ADMIN") {
      return this.getAdminStats();
    }

    if (user.role === "BILLING_SPECIALIST" || user.role === "PROVIDER") {
      const orgFilter = user.organizationId ? { hospitalOrganizationId: user.organizationId } : { ownerId: user.id };
      const [totalClaims, submittedClaims, approvedClaims, deniedClaims, pendingAppeals] = await Promise.all([
        prisma.claim.count({ where: orgFilter }),
        prisma.claim.count({ where: { ...orgFilter, status: "SUBMITTED" } }),
        prisma.claim.count({ where: { ...orgFilter, status: "APPROVED" } }),
        prisma.claim.count({ where: { ...orgFilter, status: "DENIED" } }),
        prisma.appealLetter.count({
          where: {
            claim: orgFilter,
            status: { in: ["SUBMITTED_FOR_REVIEW", "IN_REVIEW", "SUBMITTED"] }
          }
        })
      ]);
      return {
        organizationType: "HOSPITAL",
        totalClaims,
        submittedClaims,
        approvedClaims,
        deniedClaims,
        pendingAppeals
      };
    }

    if (user.role === "COMPLIANCE_REVIEWER" || user.role === "REVIEWER") {
      const orgFilter = user.organizationId ? { insuranceOrganizationId: user.organizationId } : {};
      const [receivedClaims, pendingClaimReviews, approvedClaims, deniedClaims, pendingAppeals] = await Promise.all([
        prisma.claim.count({ where: orgFilter }),
        prisma.claim.count({ where: { ...orgFilter, status: "SUBMITTED" } }),
        prisma.claim.count({ where: { ...orgFilter, status: "APPROVED" } }),
        prisma.claim.count({ where: { ...orgFilter, status: "DENIED" } }),
        prisma.appealLetter.count({
          where: {
            claim: orgFilter,
            status: { in: ["SUBMITTED_FOR_REVIEW", "IN_REVIEW", "SUBMITTED"] }
          }
        })
      ]);
      return {
        organizationType: "INSURANCE_COMPANY",
        receivedClaims,
        pendingClaimReviews,
        approvedClaims,
        deniedClaims,
        pendingAppeals
      };
    }

    return this.getAdminStats();
  },

  async getAdminStats() {
    const [totalUsers, totalClaims, deniedClaims, totalAppeals, pendingReviews, approvedAppeals, rejectedAppeals] = await Promise.all([
      prisma.user.count(),
      prisma.claim.count(),
      prisma.claim.count({ where: { status: "DENIED" } }),
      prisma.appealLetter.count(),
      prisma.appealLetter.count({ where: { status: { in: ["SUBMITTED_FOR_REVIEW", "IN_REVIEW", "SUBMITTED"] } } }),
      prisma.appealLetter.count({ where: { status: "APPROVED" } }),
      prisma.appealLetter.count({ where: { status: "REJECTED" } })
    ]);

    const [activeUsers, inactiveUsers, billingSpecialists, reviewers, admins] = await Promise.all([
      prisma.user.count({ where: { active: true } }),
      prisma.user.count({ where: { active: false } }),
      prisma.user.count({ where: { role: { in: ["BILLING_SPECIALIST", "PROVIDER"] } } }),
      prisma.user.count({ where: { role: { in: ["REVIEWER", "COMPLIANCE_REVIEWER"] } } }),
      prisma.user.count({ where: { role: "ADMIN" } })
    ]);

    const claimsSum = await prisma.claim.aggregate({
      _sum: { amount: true }
    });

    const [recentClaims, recentLetters] = await Promise.all([
      prisma.claim.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true, claimNumber: true, patientName: true, hospitalName: true, payerName: true,
          status: true, amount: true, currency: true, createdAt: true
        }
      }),
      prisma.appealLetter.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true, subject: true, status: true, createdAt: true,
          claim: { select: { claimNumber: true } }
        }
      })
    ]);

    return {
      totalUsers,
      totalClaims,
      deniedClaims,
      totalAppeals,
      pendingReviews,
      approvedAppeals,
      rejectedAppeals,
      recentClaims,
      recentLetters,
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: inactiveUsers,
        byRole: {
          BILLING_SPECIALIST: billingSpecialists,
          COMPLIANCE_REVIEWER: reviewers,
          ADMIN: admins
        }
      },
      claims: {
        total: totalClaims,
        denied: deniedClaims,
        pendingReview: pendingReviews,
        approved: approvedAppeals,
        rejected: rejectedAppeals,
        totalAmountINR: Number(claimsSum._sum.amount || 0)
      },
      appealLetters: {
        total: totalAppeals,
        draft: Math.max(0, totalAppeals - (pendingReviews + approvedAppeals + rejectedAppeals)),
        submittedForReview: pendingReviews,
        approved: approvedAppeals,
        rejected: rejectedAppeals
      }
    };
  }
};
