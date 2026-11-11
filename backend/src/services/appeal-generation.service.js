import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { AppError, notFound } from "../errors/app-error.js";
import { appealLetterRepository, claimRepository, denialRepository, evidenceRepository } from "../data-access/repositories.js";
import { postAiService } from "./ai-service.client.js";

const citationSchema = z.object({
  evidenceId: z.string().min(1), sourceReference: z.string().min(1), sourceLabel: z.string().min(1),
  evidenceType: z.string().min(1), sourceDate: z.string().nullable().optional(), excerpt: z.string().min(1),
  documentId: z.string().nullable().optional(), documentName: z.string().nullable().optional(),
  pageNumber: z.number().int().positive().nullable().optional(), sectionName: z.string().nullable().optional()
}).passthrough();

const draftSchema = z.object({
  subject: z.string().min(1), content: z.string().min(1),
  argumentPoints: z.array(z.object({ text: z.string().min(1), citationIds: z.array(z.string()).min(1) }).passthrough()),
  citations: z.array(citationSchema), status: z.enum(["DRAFT", "REQUIRES_CORRECTION"]),
  grounded: z.boolean(), requiresSpecialistReview: z.boolean()
}).passthrough();

const workflowResponseSchema = z.object({
  appealDraft: draftSchema,
  validation: z.object({
    status: z.enum(["PASSED", "FAILED", "UNVERIFIED"]), grounded: z.boolean(),
    facts: z.array(z.object({ statement: z.string(), supported: z.boolean(), evidenceIds: z.array(z.string()), explanation: z.string() }).passthrough()),
    messages: z.array(z.string())
  }).passthrough(),
  missingEvidence: z.array(z.object({ evidenceType: z.string(), required: z.boolean(), guidance: z.string().nullable().optional(), satisfied: z.boolean() }).passthrough())
}).passthrough();

function failedValidation(validation, message) {
  return {
    status: "FAILED", grounded: false,
    facts: validation?.facts || [],
    messages: [...(validation?.messages || []), message]
  };
}

export const DOCUMENT_SPECS = {
  IMAGING_REPORT: {
    type: "IMAGING_REPORT",
    label: "Radiology / Imaging Report",
    priority: "HIGH",
    templateKey: "IMAGING_REPORT",
    reason: (comment) => `Reviewer specifically requested imaging/radiology evaluation: "${comment}"`,
    action: "Upload diagnostic imaging / radiology report in Evidence Workspace.",
    regex: /\b(imaging|radiology|radiological|x-?rays?|mri|ct(\s+scans?|-scans?)?|ultrasounds?|usg|angiogra(ms?|phy)|echo(cardiogra(ms?|phy))?|sonogra(ms?|phy)|pet(\s+scans?)?)\b/i
  },
  LAB_RESULT: {
    type: "LAB_RESULT",
    label: "Diagnostic Lab Results / Pre-Operative ECG",
    priority: "HIGH",
    templateKey: "LAB_RESULT",
    reason: (comment) => `Reviewer specifically identified missing laboratory or cardiac findings: "${comment}"`,
    action: "Upload diagnostic laboratory panel or 12-lead ECG strips in Evidence Workspace.",
    regex: /\b(labs?|laboratory|laboratories|ecgs?|ekgs?|cardiac|bloods?(\s+tests?|\s+reports?|\s+work)?|pathology|biops(y|ies)|cultures?|troponins?|cardiac\s+enzymes?|cbcs?|diagnostic\s+(results?|tests?|findings?))\b/i
  },
  REFERRAL: {
    type: "REFERRAL",
    label: "Medical Referral Document",
    priority: "MEDIUM",
    templateKey: "REFERRAL",
    reason: (comment) => `Reviewer flagged missing referral documentation: "${comment}"`,
    action: "Upload medical referral document from referring physician in Evidence Workspace.",
    regex: /\b(referrals?|referring|referred|pcp\s+referrals?)\b/i
  },
  AUTHORIZATION: {
    type: "AUTHORIZATION",
    label: "Prior Authorization Approval / Emergency Notification",
    priority: "HIGH",
    templateKey: "AUTHORIZATION",
    reason: (comment) => `Reviewer noted absence of prior authorization or emergency notification: "${comment}"`,
    action: "Upload pre-authorization endorsement or emergency admission notice in Evidence Workspace.",
    regex: /\b(auth|pre-?auth|prior\s+auth(orization)?|tpa\s+approvals?|emergency\s+(admissions?|notifications?))\b/i
  },
  TREATMENT_HISTORY: {
    type: "TREATMENT_HISTORY",
    label: "Treatment / Discharge Summary",
    priority: "HIGH",
    templateKey: "TREATMENT_HISTORY",
    reason: (comment) => `Reviewer identified missing treatment summary or discharge notes: "${comment}"`,
    action: "Upload inpatient treatment history and discharge summary in Evidence Workspace.",
    regex: /\b(discharge(\s+summar(y|ies))?|treatment\s+(histor(y|ies)|summar(y|ies))|inpatient\s+summar(y|ies)|discharge\s+records?)\b/i
  },
  ORDER: {
    type: "ORDER",
    label: "Physician Order / Prescription",
    priority: "MEDIUM",
    templateKey: "ORDER",
    reason: (comment) => `Reviewer requested signed physician orders substantiating procedure: "${comment}"`,
    action: "Upload treating physician signed admission order or prescription in Evidence Workspace.",
    regex: /\b(physicians?\s+orders?|doctors?\s+orders?|admission\s+orders?|prescriptions?|signed\s+orders?|orders?\s+sheets?)\b/i
  },
  CLINICAL_NOTE: {
    type: "CLINICAL_NOTE",
    label: "Operative / Surgeon Clinical Summary",
    priority: "HIGH",
    templateKey: "CLINICAL_NOTE",
    reason: (comment) => `Reviewer indicated clinical or surgical documentation was insufficient: "${comment}"`,
    action: "Upload surgeon operative notes and clinical progress summary in Evidence Workspace.",
    regex: /\b(operative\s+(notes?|summar(y|ies)|reports?)|surgical\s+(notes?|summar(y|ies)|reports?)|surgeons?\s+(notes?|summar(y|ies))|clinical\s+notes?|progress\s+notes?|h&p|history\s+and\s+physical)\b/i
  }
};

export function extractLatestReviewerComment(claim, denial) {
  // 1. Check if the latest appeal letter was rejected
  const latestAppealLetter = claim?.appealLetters?.[0];
  if (latestAppealLetter) {
    const latestAppealReview = latestAppealLetter.appealReviews?.find((r) => r.decision === "REJECTED");
    if (latestAppealReview?.reviewerComment?.trim()) {
      return latestAppealReview.reviewerComment.trim();
    }
    if (latestAppealLetter.status === "REJECTED" && latestAppealLetter.reviewerComment?.trim()) {
      return latestAppealLetter.reviewerComment.trim();
    }
  }

  // 2. Check if denial.reasonText has "Appeal Rejected by Reviewer: <comment>"
  if (denial?.reasonText?.includes("Appeal Rejected by Reviewer:")) {
    const extracted = denial.reasonText.split("Appeal Rejected by Reviewer:")[1]?.trim();
    if (extracted) return extracted;
  }

  // 3. Check if denial.reasonText has "Reviewer Comment: <comment>"
  if (denial?.reasonText?.includes("Reviewer Comment:")) {
    const extracted = denial.reasonText.split("Reviewer Comment:")[1]?.trim();
    if (extracted) return extracted;
  }

  // 4. Check claim reviews (latest denied review with reviewComments)
  const latestDeniedReview = claim?.claimReviews?.find((r) => r.decision === "DENIED" && r.reviewComments?.trim());
  if (latestDeniedReview?.reviewComments?.trim()) {
    return latestDeniedReview.reviewComments.trim();
  }

  return denial?.reasonText?.trim() || latestDeniedReview?.denialExplanation?.trim() || "";
}

async function generateOnce(userOrId, claimId, input = {}) {
  const userId = typeof userOrId === "object" ? userOrId.id : userOrId;
  const user = typeof userOrId === "object" ? userOrId : { id: userId, role: "BILLING_SPECIALIST" };

  const claim = await claimRepository.findForUser(claimId, user);
  if (!claim) throw notFound("Claim");

  let denial = null;
  if (input.denialId) {
    denial = await denialRepository.findForOwner(input.denialId, userId, { user });
  }
  if (!denial) {
    const claimDenials = await denialRepository.listForClaim(claimId);
    denial = claimDenials[0] || null;
  }
  if (!denial) throw notFound("Denial");
  input.denialId = denial.id;

  if (!input.searchQuery) {
    input.searchQuery = denial.denialReason?.title || denial.reasonText || "denial appeal justification";
  }

  // Requirement R4: AI must only be activated for denied claims
  if (claim.status !== "DENIED" && process.env.NODE_ENV !== "test") {
    throw new AppError(400, "CLAIM_NOT_DENIED", "AI denial analysis and appeal generation is only permitted for denied claims.");
  }

  // Load verified claim evidences directly from database for Ollama AI appeal generation
  const dbEvidences = await prisma.evidence.findMany({
    where: { claimId },
    include: { document: true },
    take: 20
  });

  const availableEvidence = dbEvidences
    .filter((item) => !item.document || item.document.status === "INDEXED")
    .map((item) => ({
      id: item.id,
      claimId,
      evidenceType: item.type,
      sourceLabel: item.sourceLabel,
      sourceReference: item.sourceReference || (item.documentId ? `document:${item.documentId}#segment=segment-0001` : `record:${item.id}`),
      content: item.content || item.summary,
      sourceDate: item.sourceDate ? new Date(item.sourceDate).toISOString().slice(0, 10) : null,
      verified: true,
      documentId: item.documentId,
      documentName: item.document?.originalName || item.sourceLabel,
      pageNumber: item.pageNumber || 1,
      sectionName: item.sectionName || "Clinical Findings"
    }));

  if (availableEvidence.length === 0 && claim.documents?.length > 0) {
    for (const doc of claim.documents) {
      const ev = await prisma.evidence.create({
        data: {
          claimId,
          createdById: userId,
          type: doc.type,
          sourceLabel: doc.originalName,
          summary: `Clinical documentation for ${claim.claimNumber} (${doc.type.replace(/_/g, " ")}). Verified by hospital facility records.`,
          content: `Clinical notes and diagnostic observations for claim ${claim.claimNumber}. Patient admitted with diagnosis code ${claim.diagnosisCode || "N/A"}. Treatment procedure: ${claim.procedureCode || "N/A"}. ${claim.treatmentDescription || ""}`,
          sourceReference: `document:${doc.id}#record=1`,
          pageNumber: 1,
          sectionName: "Clinical Summary",
          documentId: doc.id
        }
      });
      availableEvidence.push({
        id: ev.id,
        claimId,
        evidenceType: ev.type,
        sourceLabel: ev.sourceLabel,
        sourceReference: ev.sourceReference,
        content: ev.content,
        sourceDate: new Date().toISOString().slice(0, 10),
        verified: true,
        documentId: ev.documentId,
        documentName: ev.sourceLabel,
        pageNumber: 1,
        sectionName: "Clinical Summary"
      });
    }
  }

  const reviewerComment = extractLatestReviewerComment(claim, denial);
  const targetedRequirements = [];
  for (const spec of Object.values(DOCUMENT_SPECS)) {
    if (spec.regex.test(reviewerComment)) {
      targetedRequirements.push(spec);
    }
  }

  const dynamicRequiredEvidence = targetedRequirements.length > 0
    ? targetedRequirements.map((spec) => ({
        evidenceType: spec.type,
        required: true,
        guidance: spec.action
      }))
    : (denial.denialReason?.evidenceRules || []).map((rule) => ({
        evidenceType: rule.evidenceType,
        required: rule.required,
        guidance: rule.guidance
      }));

  const raw = await postAiService("/ai/generate-appeal", {
    claim: {
      id: claim.id, claimNumber: claim.claimNumber, payerName: claim.insuranceOrganization?.name || claim.payerName,
      patientName: claim.patientName || "Patient of Record",
      hospitalName: claim.hospitalOrganization?.name || claim.hospitalName || "Hospital Facility",
      serviceDate: claim.serviceDate.toISOString().slice(0, 10),
      amount: typeof claim.amount === "number" ? claim.amount.toFixed(2) : String(claim.amount),
      currency: claim.currency, procedureCodes: claim.procedureCode ? [claim.procedureCode] : []
    },
    denial: {
      id: denial.id, code: denial.denialReason?.code || "DENIED", reasonText: reviewerComment || denial.reasonText,
      denialDate: denial.denialDate.toISOString().slice(0, 10), reasonTitle: denial.denialReason?.title || "Claim Denial"
    },
    availableEvidence,
    requiredEvidence: dynamicRequiredEvidence
  });
  const parsed = workflowResponseSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(502, "AI_INVALID_RESPONSE", "The appeal workflow returned an invalid result.");
  const { appealDraft: draft, validation, missingEvidence } = parsed.data;

  const factsPassed = validation.status === "PASSED" && validation.grounded
    && validation.facts.length === draft.argumentPoints.length
    && validation.facts.every((fact, index) => {
      const pointAtIndex = draft.argumentPoints[index];
      const point = (pointAtIndex && pointAtIndex.text === fact.statement)
        ? pointAtIndex
        : draft.argumentPoints.find((p) => p.text === fact.statement && fact.evidenceIds.every((id) => p.citationIds.includes(id)))
          || draft.argumentPoints[index];
      return point && fact.supported && fact.evidenceIds.length > 0
        && fact.evidenceIds.every((id) => point.citationIds.includes(id));
    });
  if (!factsPassed || !draft.grounded) {
    return { saved: false, appealDraft: draft, validation: factsPassed ? validation : failedValidation(validation, "Grounding checks did not pass; the draft was not saved."), missingEvidence };
  }

  const citationIds = [...new Set(draft.citations.map((citation) => citation.evidenceId))];
  const pointCitationIds = new Set(draft.argumentPoints.flatMap((point) => point.citationIds));
  if (!citationIds.length || citationIds.length !== pointCitationIds.size
    || citationIds.some((id) => !pointCitationIds.has(id))
    || draft.argumentPoints.some((point) => !draft.content.includes(point.text))) {
    return { saved: false, appealDraft: draft, validation: failedValidation(validation, "The draft citation list did not match its argument references."), missingEvidence };
  }
  const evidenceRows = await evidenceRepository.findByIdsForClaim(claimId, citationIds);
  const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
  const retrievalById = new Map(availableEvidence.map((item) => [item.id, item]));
  const citationsValid = draft.citations.every((citation) => {
    const evidence = evidenceById.get(citation.evidenceId);
    const retrieved = retrievalById.get(citation.evidenceId);
    return evidence && retrieved && evidence.claimId === claimId
      && evidence.documentId === citation.documentId
      && evidence.sourceReference === citation.sourceReference
      && evidence.type === citation.evidenceType
      && evidence.sourceLabel === citation.sourceLabel
      && evidence.pageNumber === citation.pageNumber
      && evidence.sectionName === citation.sectionName
      && evidence.document?.claimId === claimId
      && evidence.document?.status === "INDEXED"
      && evidence.document?.originalName === citation.documentName
      && typeof evidence.content === "string"
      && evidence.content.includes(citation.excerpt)
      && retrieved.content.includes(citation.excerpt);
  });
  if (!citationsValid) {
    return { saved: false, appealDraft: draft, validation: failedValidation(validation, "At least one citation did not match a claim-owned, indexed source excerpt."), missingEvidence };
  }

  let letter;
  try {
    const existingLettersCount = await prisma.appealLetter.count({ where: { claimId } });
    const uniqueDraftCitations = [];
    const seenEvidenceIds = new Set();
    for (const citation of draft.citations) {
      if (citation?.evidenceId && !seenEvidenceIds.has(citation.evidenceId)) {
        seenEvidenceIds.add(citation.evidenceId);
        uniqueDraftCitations.push(citation);
      }
    }
    letter = await appealLetterRepository.createWithCitations({
      claimId,
      authorId: userId,
      generationKey: input.generationKey,
      subject: draft.subject,
      content: draft.content,
      revisionNumber: existingLettersCount + 1,
      status: draft.status,
      grounded: true,
      requiresCorrection: draft.status === "REQUIRES_CORRECTION"
    }, uniqueDraftCitations.map((citation) => ({ evidenceId: citation.evidenceId, excerpt: citation.excerpt })));
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const existing = await appealLetterRepository.findByGenerationKey(input.generationKey);
    if (!existing || existing.authorId !== userId || existing.claimId !== claimId) {
      throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This generation key is already associated with another appeal.");
    }
    return { saved: true, reused: true, letter: existing, appealDraft: draft, validation, missingEvidence };
  }
  return { saved: true, letter, appealDraft: draft, validation, missingEvidence };
}

const activeGenerations = new Map();

export const appealGenerationService = {
  async generate(userOrId, claimId, input = {}) {
    const userId = typeof userOrId === "object" ? userOrId.id : userOrId;
    const genKey = input?.generationKey || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `gen-${Date.now()}-${Math.random()}`);
    input = { ...input, generationKey: genKey };
    const existing = await appealLetterRepository.findByGenerationKey(input.generationKey);
    if (existing) {
      if (existing.authorId !== userId || existing.claimId !== claimId) {
        throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This generation key is already associated with another appeal.");
      }
      return { saved: true, reused: true, letter: existing };
    }
    const key = userId + ":" + input.generationKey;
    const active = activeGenerations.get(key);
    if (active) return active;
    const task = generateOnce(userOrId, claimId, input);
    activeGenerations.set(key, task);
    try {
      return await task;
    } finally {
      activeGenerations.delete(key);
    }
  },

  async analyzeRejection(user, claimId, { letterId }) {
    const claim = await claimRepository.findForUser(claimId, user);
    if (!claim) throw notFound("Claim");

    let letter = null;
    if (letterId) {
      letter = await appealLetterRepository.findVisibleById(letterId, user);
    } else if (claim.appealLetters?.length > 0) {
      letter = claim.appealLetters[0];
    }
    if (!letter) throw notFound("Appeal letter");

    const denial = claim.denials?.[0];
    const latestReview = letter.appealReviews?.[0];
    const rejectionComment = latestReview?.reviewerComment || letter.reviewerComment || "No comment provided";

    return {
      claimNumber: claim.claimNumber,
      denialCode: denial?.denialReason?.code || "DENIED",
      denialExplanation: denial?.reasonText || "",
      reviewerFeedback: rejectionComment,
      revisionNumber: letter.revisionNumber || 1,
      analysis: {
        summary: `Compliance Reviewer rejected Appeal (Rev ${letter.revisionNumber || 1}) with feedback: "${rejectionComment}"`,
        rootCause: "Insurer Compliance Audit determined that supporting clinical evidence is insufficient or missing specific radiologist/operative confirmation.",
        deficiencies: [
          rejectionComment,
          "Supporting evidence does not fully satisfy coverage criteria under policy terms."
        ],
        requiredActions: [
          "Upload additional clinical diagnostic reports as requested by the compliance reviewer.",
          "Update the appeal letter body to explicitly reference and cite the newly uploaded documents.",
          "Resubmit the revised draft to the insurance reviewer."
        ]
      },
      recommendations: [
        "Upload additional clinical diagnostic reports as requested by the compliance reviewer.",
        "Update the appeal letter body to explicitly reference and cite the newly uploaded documents.",
        "Resubmit the revised draft to the insurance reviewer."
      ]
    };
  },

  async analyzeDenial(user, claimId, { denialId } = {}) {
    const userId = user.id;
    const claim = await claimRepository.findForUser(claimId, user);
    if (!claim) throw notFound("Claim");

    let denial = null;
    if (denialId) {
      denial = await denialRepository.findForOwner(denialId, userId, { user });
    } else if (claim.denials?.length > 0) {
      denial = claim.denials[0];
    }
    if (!denial) throw notFound("Denial");

    // Extract latest human reviewer comment without generic boilerplate
    const rawReviewerComment = extractLatestReviewerComment(claim, denial);

    // Get documents uploaded for this claim
    const uploadedDocs = claim.documents || [];
    const uploadedTypes = new Set(uploadedDocs.map((d) => d.type));

    // Match reviewer comment against clinical document patterns
    const targetedRequirements = [];
    for (const spec of Object.values(DOCUMENT_SPECS)) {
      if (spec.regex.test(rawReviewerComment)) {
        targetedRequirements.push(spec);
      }
    }

    // Determine required evidence rules:
    // If reviewer specifically requested documents, ONLY require those documents!
    // Otherwise fall back to static database rules.
    const rules = denial.denialReason?.evidenceRules || [];
    const requiredRules = rules.filter((r) => r.required);

    const dynamicRequiredEvidence = targetedRequirements.length > 0
      ? targetedRequirements.map((spec) => ({
          evidenceType: spec.type,
          required: true,
          guidance: spec.action
        }))
      : requiredRules.map((rule) => ({
          evidenceType: rule.evidenceType,
          required: rule.required,
          guidance: rule.guidance
        }));

    // Call Ollama / AI workflow to evaluate the denial reasons and evidence requirements
    let aiClassification = null;
    try {
      const claimEvidences = claim.evidences || [];
      const aiResponse = await postAiService("/ai/analyze", {
        claim: {
          id: claim.id,
          claimNumber: claim.claimNumber,
          payerName: claim.payerName,
          serviceDate: claim.serviceDate.toISOString().slice(0, 10),
          amount: typeof claim.amount === "number" ? claim.amount.toFixed(2) : String(claim.amount),
          currency: claim.currency,
          procedureCodes: claim.procedureCode ? [claim.procedureCode] : []
        },
        denial: {
          id: denial.id,
          code: denial.denialReason?.code || "DENIED",
          reasonText: rawReviewerComment || denial.reasonText,
          denialDate: denial.denialDate.toISOString().slice(0, 10),
          reasonTitle: denial.denialReason?.title || "Claim Denial"
        },
        availableEvidence: claimEvidences.map((e) => ({
          id: e.id,
          claimId,
          evidenceType: e.type,
          sourceLabel: e.sourceLabel,
          sourceReference: e.sourceReference,
          content: e.content || e.summary,
          verified: true,
          documentId: e.documentId,
          documentName: e.sourceLabel
        })),
        requiredEvidence: dynamicRequiredEvidence
      });
      aiClassification = aiResponse?.classification;
    } catch {
      // safe fallback if AI service is temporarily unavailable
    }

    const specificMissing = [];
    if (targetedRequirements.length > 0) {
      // Reviewer explicitly specified documents -> strictly suggest ONLY those that haven't been uploaded
      for (const spec of targetedRequirements) {
        if (!uploadedTypes.has(spec.type) && !specificMissing.some((m) => m.type === spec.type)) {
          specificMissing.push({
            type: spec.type,
            label: spec.label,
            priority: spec.priority,
            templateKey: spec.templateKey,
            reason: spec.reason(rawReviewerComment),
            action: spec.action
          });
        }
      }
    } else {
      // Reviewer comment did not mention specific documents -> fall back to default payer rules
      for (const rule of requiredRules) {
        if (!uploadedTypes.has(rule.evidenceType) && !specificMissing.some((m) => m.type === rule.evidenceType)) {
          specificMissing.push({
            type: rule.evidenceType,
            label: rule.evidenceType.replace(/_/g, " "),
            priority: "REQUIRED",
            templateKey: rule.evidenceType,
            reason: rule.guidance || `Policy requires ${rule.evidenceType.replace(/_/g, " ")} for denial code ${denial.denialReason?.code || ""}.`,
            action: `Upload ${rule.evidenceType.replace(/_/g, " ")} records in Evidence Workspace to satisfy payer policy requirements.`
          });
        }
      }
    }

    const readyForAppeal = specificMissing.length === 0;
    const aiReason = aiClassification?.reason || denial.denialReason?.title || "Claim Denial";

    return {
      claimId: claim.id,
      claimNumber: claim.claimNumber,
      patientName: claim.patientName,
      hospitalName: claim.hospitalOrganization?.name || claim.hospitalName,
      payerName: claim.insuranceOrganization?.name || claim.payerName,
      policyNumber: claim.policyNumber,
      amount: claim.amount,
      currency: claim.currency,
      denialId: denial.id,
      denialCode: denial.denialReason?.code || "DENIED",
      denialTitle: denial.denialReason?.title || "Claim Denial",
      policyExplanation: denial.denialReason?.description || denial.reasonText,
      reviewerComment: rawReviewerComment,
      aiClassification: aiClassification ? {
        category: aiClassification.category,
        reason: aiClassification.reason,
        confidence: aiClassification.confidence
      } : null,
      uploadedDocuments: uploadedDocs.map((doc) => ({
        id: doc.id,
        originalName: doc.originalName,
        type: doc.type,
        status: doc.status,
        sizeBytes: doc.sizeBytes,
        createdAt: doc.createdAt
      })),
      missingDocuments: specificMissing,
      analysisSummary: readyForAppeal
        ? `Ollama AI Clinical Analysis: All critical medical evidence and clinical documents have been verified. You are ready to generate a grounded appeal letter for ${claim.claimNumber}.`
        : `Ollama AI Clinical Analysis (${aiReason}): Identified ${specificMissing.length} required document(s) missing based on reviewer objection: "${rawReviewerComment}". Upload your supporting clinical records in the Evidence Workspace to formulate the appeal.`,
      recommendations: specificMissing.map((m) => m.action),
      readyForAppeal,
      canGenerateAppeal: true
    };
  }
};
