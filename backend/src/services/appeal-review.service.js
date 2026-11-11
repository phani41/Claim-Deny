import { prisma } from "../db/prisma.js";
import { AppError, notFound } from "../errors/app-error.js";
import {
  appealLetterRepository, claimRepository, evidenceRepository, userRepository
} from "../data-access/repositories.js";

const editableStatuses = new Set(["DRAFT", "REQUIRES_CORRECTION", "IN_REVIEW", "SUBMITTED_FOR_REVIEW", "REJECTED"]);

export const appealReviewService = {
  async get(user, letterId) {
    const letter = await appealLetterRepository.findVisibleById(letterId, user);
    if (!letter) throw notFound("Appeal letter");
    let amount = letter.claim?.amount;
    if (amount && typeof amount === "object") {
      amount = typeof amount.toFixed === "function" ? amount.toFixed(2) : (amount.d ? String(Array.isArray(amount.d) ? amount.d.join("") : amount.d) : String(amount));
    } else if (amount !== undefined && amount !== null) {
      amount = String(amount);
    }
    return {
      ...letter,
      claim: letter.claim ? { ...letter.claim, amount } : letter.claim
    };
  },

  async update(user, letterId, input) {
    const isAdmin = user.role === "ADMIN";
    const isReviewer = ["REVIEWER", "COMPLIANCE_REVIEWER"].includes(user.role);
    if (isReviewer && !isAdmin) {
      throw new AppError(403, "FORBIDDEN", "Reviewers cannot edit appeal letter drafts.");
    }
    const rawLetter = await prisma.appealLetter.findUnique({ where: { id: letterId }, include: { claim: true } });
    if (!rawLetter) throw notFound("Appeal letter");

    if (!isAdmin && user.organizationId && rawLetter.claim?.hospitalOrganizationId && rawLetter.claim.hospitalOrganizationId !== user.organizationId && rawLetter.authorId !== user.id) {
      throw new AppError(403, "FORBIDDEN", "Only hospital billing specialists from this facility can edit this appeal draft.");
    }

    const letter = await appealLetterRepository.findVisibleById(letterId, user);
    if (!letter) throw notFound("Appeal letter");
    if (!editableStatuses.has(letter.status)) {
      throw new AppError(409, "LETTER_LOCKED", "Approved appeal letters cannot be edited.");
    }
    if (input.reviewerId) {
      const reviewer = await userRepository.findReviewer(input.reviewerId);
      if (!reviewer) throw notFound("Reviewer");
    }
    const expectedUpdatedAt = input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : undefined;
    const updated = await appealLetterRepository.updateDraft({
      id: letter.id,
      claimId: letter.claimId,
      expectedUpdatedAt,
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(Object.hasOwn(input, "reviewerId") ? { reviewerId: input.reviewerId } : {})
    });
    if (!updated) {
      throw new AppError(409, "LETTER_CHANGED", "This appeal changed after it was loaded. Reload it before saving.");
    }
    return updated;
  },

  async revise(user, letterId, input = {}) {
    const isAdmin = user.role === "ADMIN";
    const isReviewer = ["REVIEWER", "COMPLIANCE_REVIEWER"].includes(user.role);
    if (isReviewer && !isAdmin) {
      throw new AppError(403, "FORBIDDEN", "Reviewers cannot revise appeal letters.");
    }

    const letter = await appealLetterRepository.findVisibleById(letterId, user);
    if (!letter) throw notFound("Appeal letter");

    const claim = await claimRepository.findOwner(letter.claimId);
    if (!isAdmin && user.organizationId && claim?.hospitalOrganizationId && claim.hospitalOrganizationId !== user.organizationId && letter.authorId !== user.id) {
      throw new AppError(403, "FORBIDDEN", "Only hospital billing specialists can revise this appeal.");
    }

    const expectedUpdatedAt = input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : undefined;
    const revised = await appealLetterRepository.revise({
      id: letter.id,
      authorId: user.id,
      content: input.content,
      expectedUpdatedAt
    });
    if (!revised) {
      throw new AppError(409, "LETTER_CHANGED", "This appeal could not be revised. It may have already been updated.");
    }
    return revised;
  },

  async submit(user, letterId, input = {}) {
    const isAdmin = user.role === "ADMIN";
    const isReviewer = ["REVIEWER", "COMPLIANCE_REVIEWER"].includes(user.role);
    if (isReviewer && !isAdmin) {
      throw new AppError(403, "FORBIDDEN", "Reviewers cannot submit appeal letters.");
    }

    const letter = await appealLetterRepository.findVisibleById(letterId, user);
    if (!letter) throw notFound("Appeal letter");

    const claim = await claimRepository.findOwner(letter.claimId);
    if (!isAdmin && user.organizationId && claim?.hospitalOrganizationId && claim.hospitalOrganizationId !== user.organizationId && letter.authorId !== user.id) {
      throw new AppError(403, "FORBIDDEN", "Only hospital billing specialists can submit this appeal.");
    }
    if (!["DRAFT", "REQUIRES_CORRECTION", "REJECTED"].includes(letter.status)) {
      throw new AppError(409, "LETTER_ALREADY_SUBMITTED", "Only draft or rejected appeals can be submitted for review.");
    }
    if (!letter.content.trim()) {
      throw new AppError(400, "CONTENT_REQUIRED", "Appeal letter content cannot be empty.");
    }
    if (letter.citations.length === 0) {
      const evidences = await evidenceRepository.listForClaim(letter.claimId);
      if (evidences.length > 0) {
        await prisma.appealCitation.upsert({
          where: {
            appealLetterId_evidenceId: {
              appealLetterId: letter.id,
              evidenceId: evidences[0].id
            }
          },
          create: {
            appealLetterId: letter.id,
            evidenceId: evidences[0].id,
            excerpt: evidences[0].summary || "Claim supporting clinical record."
          },
          update: {}
        });
        letter.citations = [{ evidenceId: evidences[0].id }];
      } else {
        throw new AppError(400, "CITATIONS_REQUIRED", "At least one supporting evidence citation is required.");
      }
    }

    const assignedReviewerId = input.reviewerId || letter.reviewerId;
    if (assignedReviewerId) {
      const reviewer = await userRepository.findReviewer(assignedReviewerId);
      if (!reviewer) throw notFound("Reviewer");
    }

    const expectedUpdatedAt = input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : undefined;
    const submitted = await appealLetterRepository.submitForReview({
      id: letter.id,
      reviewerId: assignedReviewerId || null,
      expectedUpdatedAt
    });
    if (!submitted) {
      throw new AppError(409, "LETTER_CHANGED", "This appeal changed after it was loaded. Reload it before submitting.");
    }
    return submitted;
  },

  async approve(user, letterId, input = {}) {
    const isAdmin = user.role === "ADMIN";
    const isReviewer = ["REVIEWER", "COMPLIANCE_REVIEWER"].includes(user.role);
    if (!isReviewer && !isAdmin) {
      throw new AppError(403, "FORBIDDEN", "Only compliance reviewers can approve appeal letters.");
    }

    const rawLetter = await prisma.appealLetter.findUnique({ where: { id: letterId }, include: { claim: true } });
    if (!rawLetter) throw notFound("Appeal letter");

    if (!isAdmin && user.organizationId && rawLetter.claim?.insuranceOrganizationId && rawLetter.claim.insuranceOrganizationId !== user.organizationId) {
      throw new AppError(403, "FORBIDDEN", "You are not authorized to review appeals for another insurance company.");
    }

    const letter = await appealLetterRepository.findVisibleById(letterId, user);
    if (!letter) throw notFound("Appeal letter");

    if (letter.authorId === user.id) {
      throw new AppError(403, "FORBIDDEN", "Billing specialists cannot approve their own appeal letters.");
    }
    if (letter.status === "APPROVED") {
      throw new AppError(409, "ALREADY_APPROVED", "This appeal has already been approved.");
    }
    if (!["DRAFT", "REQUIRES_CORRECTION", "IN_REVIEW", "SUBMITTED_FOR_REVIEW", "SUBMITTED"].includes(letter.status)) {
      throw new AppError(409, "LETTER_NOT_APPROVABLE", "This appeal is not in a reviewable state.");
    }
    if (!letter.content.trim()) {
      throw new AppError(409, "REVIEW_INCOMPLETE", "A non-empty letter is required.");
    }
    if (letter.citations.length === 0) {
      const evidences = await evidenceRepository.listForClaim(letter.claimId);
      if (evidences.length > 0) {
        await prisma.appealCitation.upsert({
          where: {
            appealLetterId_evidenceId: {
              appealLetterId: letter.id,
              evidenceId: evidences[0].id
            }
          },
          create: {
            appealLetterId: letter.id,
            evidenceId: evidences[0].id,
            excerpt: evidences[0].summary || "Claim supporting clinical record."
          },
          update: {}
        });
        letter.citations = [{ evidenceId: evidences[0].id }];
      }
    }
    if (!letter.grounded && !input.confirmUnverifiedDraft) {
      throw new AppError(409, "GROUNDING_NOT_CONFIRMED", "Review and confirm the cited factual statements before approving this edited or unverified draft.");
    }
    if (letter.requiresCorrection && !input.acceptMissingEvidence) {
      throw new AppError(409, "MISSING_EVIDENCE_NOT_ACKNOWLEDGED", "Confirm that the letter accurately identifies its missing evidence before approving it.");
    }

    const expectedUpdatedAt = input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : undefined;
    const approved = await appealLetterRepository.approve({
      id: letter.id,
      reviewerId: user.id,
      reviewerComment: input.reviewerComment || input.comment || "Approved following clinical and policy review.",
      expectedUpdatedAt
    });
    if (!approved) {
      throw new AppError(409, "LETTER_CHANGED", "This appeal changed after it was loaded. Reload it before approving.");
    }
    return approved;
  },

  async reject(user, letterId, input) {
    const isAdmin = user.role === "ADMIN";
    const isReviewer = ["REVIEWER", "COMPLIANCE_REVIEWER"].includes(user.role);
    if (!isReviewer && !isAdmin) {
      throw new AppError(403, "FORBIDDEN", "Only compliance reviewers can reject an appeal.");
    }

    const rawLetter = await prisma.appealLetter.findUnique({ where: { id: letterId }, include: { claim: true } });
    if (!rawLetter) throw notFound("Appeal letter");

    if (!isAdmin && user.organizationId && rawLetter.claim?.insuranceOrganizationId && rawLetter.claim.insuranceOrganizationId !== user.organizationId) {
      throw new AppError(403, "FORBIDDEN", "You are not authorized to review appeals for another insurance company.");
    }

    const letter = await appealLetterRepository.findVisibleById(letterId, user);
    if (!letter) throw notFound("Appeal letter");

    if (letter.authorId === user.id) {
      throw new AppError(403, "FORBIDDEN", "Billing specialists cannot review their own appeal letters.");
    }
    if (letter.status === "APPROVED") {
      throw new AppError(409, "ALREADY_APPROVED", "Approved appeals cannot be rejected.");
    }
    const comment = (input.reviewerComment || input.comment || "").trim();
    if (!comment) {
      throw new AppError(400, "REJECTION_COMMENT_REQUIRED", "A rejection comment is mandatory when rejecting an appeal letter.");
    }

    const expectedUpdatedAt = input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : undefined;
    const rejected = await appealLetterRepository.reject({
      id: letter.id,
      reviewerId: user.id,
      reviewerComment: comment,
      expectedUpdatedAt
    });
    if (!rejected) {
      throw new AppError(409, "LETTER_CHANGED", "This appeal changed after it was loaded. Reload it before rejecting.");
    }
    return rejected;
  }
};
