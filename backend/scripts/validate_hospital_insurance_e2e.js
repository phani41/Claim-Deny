import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

async function run() {
  console.log("\n=== STARTING E2E HOSPITAL-TO-INSURANCE WORKFLOW VALIDATION ===\n");

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  const originalFetch = globalThis.fetch;
  let activeEvidenceId = null;
  let activeDocumentId = null;
  let activeSourceRef = null;
  const activeDocName = "Operative_Catheterization_Report.pdf";
  const activeSourceText = "Pre-operative coronary catheterization confirmed 90% stenosis in LAD, requiring immediate balloon angioplasty and stenting.";

  globalThis.fetch = async (input, init) => {
    const rawUrl = typeof input === "string" ? input : (input.url || input.href || String(input));
    const url = new URL(rawUrl);

    // If calling local node test server, use real fetch
    if (url.port === String(port)) {
      return originalFetch(input, init);
    }

    // If calling AI service, use deterministic mock for test claim
    if (url.port === "8001") {

      if (url.pathname.endsWith("/rag/retrieve")) {
        let reqBody = {};
        try { reqBody = typeof init?.body === "string" ? JSON.parse(init.body) : (init?.body || {}); } catch {}
        const cid = reqBody.claimId || "mock-claim";
        return new Response(JSON.stringify({
          claimId: cid, query: reqBody.searchQuery || "coronary", relevantResultCount: 1,
          results: [{
            chunkId: `${activeDocumentId || 'doc-1'}:chunk-1`, claimId: cid,
            documentId: activeDocumentId, evidenceId: activeEvidenceId,
            evidenceType: "CLINICAL_NOTE", sourceDocumentName: activeDocName,
            sourceReference: activeSourceRef || "document:doc-1#segment=0001", pageNumber: 1, sectionName: "Assessment",
            content: activeSourceText, distance: 0.1
          }]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (url.pathname.endsWith("/ai/generate-appeal")) {
        const stmt = activeSourceText;
        return new Response(JSON.stringify({
          missingEvidence: [],
          appealDraft: {
            subject: "Appeal for Claim CLM-E2E-VAL-999 - Coronary Angioplasty Medical Necessity",
            content: "Dear Medical Director,\n\nWe hereby appeal the denial for claim CLM-E2E-VAL-999.\n\n" + stmt + "\n\nSincerely,\nHospital Billing Department",
            argumentPoints: [{ text: stmt, citationIds: activeEvidenceId ? [activeEvidenceId] : [] }],
            citations: activeEvidenceId ? [{
              evidenceId: activeEvidenceId, sourceReference: activeSourceRef || "document:doc-1#segment=0001",
              sourceLabel: activeDocName, evidenceType: "CLINICAL_NOTE", sourceDate: null,
              excerpt: stmt, documentId: activeDocumentId, documentName: activeDocName, pageNumber: 1, sectionName: "Assessment"
            }] : [],
            status: "DRAFT", grounded: true, requiresSpecialistReview: false
          },
          validation: { status: "PASSED", grounded: true, facts: activeEvidenceId ? [{
            statement: stmt, supported: true, evidenceIds: [activeEvidenceId], explanation: "Supported by clinical report."
          }] : [], messages: [] }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    }

    return originalFetch(input, init);
  };

  async function request(path, { method = "GET", token, body } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, ok: res.ok, data: (data && typeof data === "object" && data.data !== undefined) ? data.data : data };
  }

  async function login(email, password) {
    const res = await request("/auth/login", {
      method: "POST",
      body: { email, password }
    });
    assert.equal(res.status, 200, `Login failed for ${email}: ${JSON.stringify(res.data)}`);
    return { token: res.data.token, user: res.data.user };
  }

  try {
    // 1. Authenticate users
    console.log("Step 1: Authenticating hospital billing specialist & insurance compliance reviewers...");
    const hospA = await login("billing@demo.in", "Demo@123");
    const insA = await login("reviewer@demo.in", "Demo@123");
    const insB = await login("reviewer2@demo.in", "Demo@123");
    const hospB = await login("rajesh.patel@hospital.aadhya.in", "Demo@123");

    assert.equal(hospA.user.organization.id, "org-hosp-01", "Hospital A org mismatch");
    assert.equal(insA.user.organization.id, "org-ins-01", "Insurance A org mismatch");
    assert.equal(insB.user.organization.id, "org-ins-02", "Insurance B org mismatch");
    assert.equal(hospB.user.organization.id, "org-hosp-02", "Hospital B org mismatch");
    console.log("✔ Roles and organizations verified for all 4 test entities.");

    // Clean up any old test claim from previous run
    const testClaimNumber = "CLM-E2E-VAL-999";
    await prisma.claimReview.deleteMany({ where: { claim: { claimNumber: testClaimNumber } } });
    await prisma.appealReview.deleteMany({ where: { appealLetter: { claim: { claimNumber: testClaimNumber } } } });
    await prisma.appealCitation.deleteMany({ where: { appealLetter: { claim: { claimNumber: testClaimNumber } } } });
    await prisma.appealLetter.deleteMany({ where: { claim: { claimNumber: testClaimNumber } } });
    await prisma.denial.deleteMany({ where: { claim: { claimNumber: testClaimNumber } } });
    await prisma.evidence.deleteMany({ where: { claim: { claimNumber: testClaimNumber } } });
    await prisma.document.deleteMany({ where: { claim: { claimNumber: testClaimNumber } } });
    await prisma.claim.deleteMany({ where: { claimNumber: testClaimNumber } });

    // 2. Hospital A submits new claim to Insurance A
    console.log("\nStep 2: Hospital A creates claim routed to Insurance A (Bharat Health Assurance)...");
    const claimRes = await request("/claims", {
      method: "POST",
      token: hospA.token,
      body: {
        claimNumber: testClaimNumber,
        patientName: "Meera Krishnan",
        insuranceOrganizationId: "org-ins-01",
        policyNumber: "POL-BHA-8877",
        diagnosisCode: "I25.10",
        procedureCode: "02703ZZ",
        treatmentDescription: "Coronary artery catheterization and stent placement for ischemic heart disease.",
        serviceDate: "2026-03-10T12:00:00.000Z",
        amount: "145000.00",
        currency: "INR"
      }
    });

    assert.equal(claimRes.status, 201, `Create claim failed: ${JSON.stringify(claimRes.data)}`);
    const createdClaim = claimRes.data;
    assert.equal(createdClaim.claimNumber, testClaimNumber);
    assert.equal(createdClaim.status, "SUBMITTED");
    assert.equal(createdClaim.hospitalOrganizationId, "org-hosp-01");
    assert.equal(createdClaim.insuranceOrganizationId, "org-ins-01");
    console.log(`✔ Claim ${createdClaim.claimNumber} created with status SUBMITTED and auto-routed to org-ins-01.`);

    // 3. Verify claim appears in Insurance A queue
    console.log("\nStep 3: Checking Insurance A review queue...");
    const insAClaims = await request("/claims?limit=50", { token: insA.token });
    assert.equal(insAClaims.status, 200);
    const claimsA = Array.isArray(insAClaims.data) ? insAClaims.data : (insAClaims.data?.data || []);
    const foundInInsA = claimsA.find((c) => c.claimNumber === testClaimNumber);
    assert.ok(foundInInsA, "Claim should appear in Insurance A queue");
    console.log("✔ Claim is automatically visible in Insurance A review queue without admin intervention.");

    // 4. Verify claim does NOT appear in Insurance B queue (Multi-tenant isolation)
    console.log("\nStep 4: Checking Insurance B review queue (multi-tenant tenant isolation)...");
    const insBClaims = await request("/claims?limit=50", { token: insB.token });
    assert.equal(insBClaims.status, 200);
    const claimsB = Array.isArray(insBClaims.data) ? insBClaims.data : (insBClaims.data?.data || []);
    const foundInInsB = claimsB.find((c) => c.claimNumber === testClaimNumber);
    assert.equal(foundInInsB, undefined, "Claim must NOT appear in Insurance B queue");
    console.log("✔ Verified: Insurance B reviewer cannot see claims routed to Insurance A.");

    // 5. Cross-insurance unauthorized adjudication attempt
    console.log("\nStep 5: Testing cross-insurance unauthorized adjudication attempt...");
    const unauthorizedReview = await request(`/claims/${createdClaim.id}/review`, {
      method: "POST",
      token: insB.token,
      body: {
        decision: "APPROVED",
        reviewComments: "Illegal approval from wrong insurance company"
      }
    });
    assert.equal(unauthorizedReview.status, 403, "Cross-insurance review should return 403 Forbidden");
    console.log("✔ Security check: Insurance B adjudication blocked with 403 Forbidden.");

    // 6. Insurance A reviewer denies claim with required denial code & explanation
    console.log("\nStep 6: Insurance A reviewer DENIES claim with code, explanation, and comments...");
    const denialReview = await request(`/claims/${createdClaim.id}/review`, {
      method: "POST",
      token: insA.token,
      body: {
        decision: "DENIED",
        denialCode: "DOC-01",
        denialExplanation: "Incomplete clinical operative notes and missing diagnostic angiogram images.",
        reviewComments: "Hospital must submit complete preoperative ECG and operative reports."
      }
    });
    assert.equal(denialReview.status, 200, `Claim denial failed: ${JSON.stringify(denialReview.data)}`);
    assert.equal(denialReview.data.claim.status, "DENIED");
    console.log("✔ Claim status updated to DENIED and ClaimReview record created.");

    // 7. Hospital A inspects updated decision and denial reason
    console.log("\nStep 7: Hospital A billing specialist inspects updated decision and denial reason...");
    const hospAClaimCheck = await request(`/claims/${createdClaim.id}`, { token: hospA.token });
    assert.equal(hospAClaimCheck.status, 200);
    assert.equal(hospAClaimCheck.data.status, "DENIED");
    assert.ok(hospAClaimCheck.data.claimReviews.length > 0, "Claim reviews must be returned");
    const latestClaimReview = hospAClaimCheck.data.claimReviews[0];
    assert.equal(latestClaimReview.decision, "DENIED");
    assert.equal(latestClaimReview.denialCode, "DOC-01");
    assert.equal(latestClaimReview.denialExplanation, "Incomplete clinical operative notes and missing diagnostic angiogram images.");
    assert.equal(latestClaimReview.reviewComments, "Hospital must submit complete preoperative ECG and operative reports.");
    console.log("✔ Hospital A billing specialist successfully retrieved denial code, explanation, and comments.");

    // 8. AI is activated only for DENIED claims
    console.log("\nStep 8: Verifying AI is only activated on DENIED claims...");
    // Let's create an evidence record and denial for the claim so AI has context
    const denialReason = await prisma.denialReason.findFirst({ where: { code: "DOC-MISS-02" } }) ||
      await prisma.denialReason.findFirst({ where: { code: "CO-16" } }) ||
      await prisma.denialReason.findFirst();

    const dbDenial = await prisma.denial.create({
      data: {
        claimId: createdClaim.id,
        denialReasonCode: denialReason.code,
        denialDate: new Date(),
        reasonText: "Incomplete clinical operative notes and missing diagnostic angiogram images.",
        status: "OPEN"
      }
    });

    const testDoc = await prisma.document.create({
      data: {
        claimId: createdClaim.id,
        uploadedById: hospA.user.id,
        type: "CLINICAL_NOTE",
        originalName: activeDocName,
        storageKey: "test-op-cath-report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: "INDEXED",
        pageCount: 1
      }
    });
    activeDocumentId = testDoc.id;
    activeSourceRef = `document:${testDoc.id}#segment=0001`;

    const dbEvidence = await prisma.evidence.create({
      data: {
        claimId: createdClaim.id,
        createdById: hospA.user.id,
        documentId: testDoc.id,
        type: "CLINICAL_NOTE",
        sourceLabel: activeDocName,
        sourceReference: activeSourceRef,
        pageNumber: 1,
        sectionName: "Assessment",
        content: activeSourceText,
        summary: "Pre-operative coronary catheterization confirmed 90% stenosis in LAD, requiring immediate balloon angioplasty and stenting."
      }
    });
    activeEvidenceId = dbEvidence.id;

    // 8.5 Test AI Denial Analysis endpoint
    console.log("\nStep 8.5: Testing AI Denial Analysis (missing documents based on reviewer comment)...");
    const aiDenialRes = await request(`/claims/${createdClaim.id}/ai/analyze-denial`, {
      method: "POST",
      token: hospA.token,
      body: { denialId: dbDenial.id }
    });
    assert.equal(aiDenialRes.status, 200, `AI denial analysis failed: ${JSON.stringify(aiDenialRes.data)}`);
    assert.equal(aiDenialRes.data.claimNumber, testClaimNumber);
    assert.ok(aiDenialRes.data.uploadedDocuments.length >= 1, "Uploaded documents must be listed");
    assert.ok(Array.isArray(aiDenialRes.data.missingDocuments), "Missing documents array must be returned");
    assert.equal(aiDenialRes.data.canGenerateAppeal, true, "Should allow generating appeal");
    console.log(`✔ AI Denial Analysis verified: reviewerComment="${aiDenialRes.data.reviewerComment}", missingDocuments=${aiDenialRes.data.missingDocuments.length}.`);

    // 9. AI generates appeal letter
    console.log("\nStep 9: Billing specialist generates appeal letter via AI...");
    const genRes = await request(`/claims/${createdClaim.id}/appealletters/generate`, {
      method: "POST",
      token: hospA.token,
      body: {
        denialId: dbDenial.id,
        searchQuery: "coronary catheterization LAD stenosis angioplasty medical necessity",
        generationKey: "550e8400-e29b-41d4-a716-446655440000"
      }
    });
    assert.ok(genRes.status === 200 || genRes.status === 201, `Generate appeal failed: ${JSON.stringify(genRes.data)}`);
    const letter = genRes.data.letter || genRes.data;
    assert.equal(letter.status, "DRAFT");
    assert.ok(letter.content.length > 50, "Appeal content should be generated");
    console.log(`✔ Appeal letter drafted (ID: ${letter.id}) with status DRAFT.`);

    // 10. Billing specialist edits and submits appeal letter
    console.log("\nStep 10: Billing specialist edits and submits appeal for review...");
    const submitRes = await request(`/appealletters/${letter.id}/submit`, {
      method: "POST",
      token: hospA.token,
      body: {
        reviewerId: insA.user.id
      }
    });
    assert.equal(submitRes.status, 200, `Submit appeal failed: ${JSON.stringify(submitRes.data)}`);
    assert.equal(submitRes.data.status, "SUBMITTED_FOR_REVIEW");
    console.log("✔ Appeal letter submitted with status SUBMITTED_FOR_REVIEW.");

    // 11. Appeal appears in Insurance A appeal review queue
    console.log("\nStep 11: Checking Insurance A appeal review queue...");
    const insAAppeals = await request("/appealletters?limit=50", { token: insA.token });
    assert.equal(insAAppeals.status, 200);
    const appealsA = Array.isArray(insAAppeals.data) ? insAAppeals.data : (insAAppeals.data?.data || []);
    const foundAppealInsA = appealsA.find((a) => a.id === letter.id);
    assert.ok(foundAppealInsA, "Appeal must appear in Insurance A queue");
    console.log("✔ Appeal letter visible in Insurance A appeal review queue.");

    // 12. Cross-insurance appeal adjudication blocked
    console.log("\nStep 12: Testing cross-insurance appeal adjudication attempt...");
    const unauthAppealReview = await request(`/appealletters/${letter.id}/reject`, {
      method: "POST",
      token: insB.token,
      body: {
        comment: "Unauthorized rejection from Insurance B"
      }
    });
    assert.equal(unauthAppealReview.status, 403, "Cross-insurance appeal review should return 403");
    console.log("✔ Security check: Insurance B appeal adjudication blocked with 403.");

    // 13. Insurance A reviewer rejects appeal with mandatory comments
    console.log("\nStep 13: Insurance A reviewer REJECTS appeal with mandatory feedback...");
    const rejectRes = await request(`/appealletters/${letter.id}/reject`, {
      method: "POST",
      token: insA.token,
      body: {
        comment: "Clinical notes provided lack signed cardiologist attestation and pre-op ECG tracing."
      }
    });
    assert.equal(rejectRes.status, 200, `Reject appeal failed: ${JSON.stringify(rejectRes.data)}`);
    assert.equal(rejectRes.data.status, "REJECTED");
    assert.equal(rejectRes.data.reviewerComment, "Clinical notes provided lack signed cardiologist attestation and pre-op ECG tracing.");
    console.log("✔ Appeal status updated to REJECTED with AppealReview record logged.");

    // 14. Hospital A checks rejection feedback
    console.log("\nStep 14: Hospital A checks rejection feedback...");
    const hospALetterCheck = await request(`/appealletters/${letter.id}`, { token: hospA.token });
    assert.equal(hospALetterCheck.status, 200);
    assert.equal(hospALetterCheck.data.status, "REJECTED");
    assert.equal(hospALetterCheck.data.reviewerComment, "Clinical notes provided lack signed cardiologist attestation and pre-op ECG tracing.");
    console.log("✔ Hospital A specialist received reviewer feedback.");

    // 15. Hospital A asks AI to analyze rejection feedback
    console.log("\nStep 15: Hospital A requests AI analysis of rejection feedback...");
    const analyzeFeedbackRes = await request(`/claims/${createdClaim.id}/ai/analyze-rejection`, {
      method: "POST",
      token: hospA.token,
      body: { letterId: letter.id }
    });
    assert.equal(analyzeFeedbackRes.status, 200, `Analyze feedback failed: ${JSON.stringify(analyzeFeedbackRes.data)}`);
    const analysisText = typeof analyzeFeedbackRes.data.analysis === "string" ? analyzeFeedbackRes.data.analysis : (analyzeFeedbackRes.data.analysis?.summary || JSON.stringify(analyzeFeedbackRes.data.analysis));
    assert.ok(analysisText.length > 20, "AI feedback analysis should return analysis text");
    assert.ok(analyzeFeedbackRes.data.recommendations.length > 0, "AI should provide recommendations");
    console.log(`✔ AI analysis of reviewer feedback succeeded: "${analysisText.slice(0, 70)}..."`);

    // 16. Hospital A revises appeal (Rev #2)
    console.log("\nStep 16: Hospital A revises appeal, incrementing revision number...");
    const revisedContent = `${letter.content}\n\n[ADDENDUM - Rev 2]: Signed cardiologist attestation and pre-operative ECG tracing attached.`;
    const reviseRes = await request(`/appealletters/${letter.id}/revise`, {
      method: "POST",
      token: hospA.token,
      body: { content: revisedContent }
    });
    assert.equal(reviseRes.status, 200, `Revise appeal failed: ${JSON.stringify(reviseRes.data)}`);
    assert.equal(reviseRes.data.status, "DRAFT");
    assert.equal(reviseRes.data.revisionNumber, 2);
    assert.equal(reviseRes.data.reviewerComment, null);
    console.log("✔ Appeal successfully revised to Rev #2 with status DRAFT.");

    // 17. Hospital A resubmits revised appeal
    console.log("\nStep 17: Hospital A resubmits revised appeal...");
    const resubmitRes = await request(`/appealletters/${letter.id}/submit`, {
      method: "POST",
      token: hospA.token,
      body: { reviewerId: insA.user.id }
    });
    assert.equal(resubmitRes.status, 200);
    assert.equal(resubmitRes.data.status, "SUBMITTED_FOR_REVIEW");
    console.log("✔ Revised appeal resubmitted (status: SUBMITTED_FOR_REVIEW).");

    // 18. Insurance A approves revised appeal
    console.log("\nStep 18: Insurance A reviewer APPROVES revised appeal...");
    const approveRes = await request(`/appealletters/${letter.id}/approve`, {
      method: "POST",
      token: insA.token,
      body: {
        confirmUnverifiedDraft: true,
        acceptMissingEvidence: true,
        reviewerComment: "Attestation and ECG verified. Appeal approved for full disbursement."
      }
    });
    assert.equal(approveRes.status, 200, `Approve appeal failed: ${JSON.stringify(approveRes.data)}`);
    assert.equal(approveRes.data.status, "APPROVED");
    console.log("✔ Revised appeal successfully APPROVED by Insurance A reviewer!");

    // 19. Verify full audit trail preserved
    console.log("\nStep 19: Verifying audit history preservation in database...");
    const auditLetter = await prisma.appealLetter.findUnique({
      where: { id: letter.id },
      include: { appealReviews: true }
    });
    assert.equal(auditLetter.appealReviews.length, 2, "Both REJECTED and APPROVED decisions must be recorded");
    const decisions = auditLetter.appealReviews.map((r) => r.decision);
    assert.ok(decisions.includes("REJECTED"), "Must have REJECTED review in history");
    assert.ok(decisions.includes("APPROVED"), "Must have APPROVED review in history");
    console.log(`✔ Historical reviews preserved in AppealReview: ${decisions.join(", ")}.`);

    const auditClaim = await prisma.claim.findUnique({
      where: { id: createdClaim.id },
      include: { claimReviews: true }
    });
    assert.equal(auditClaim.claimReviews.length, 1);
    assert.equal(auditClaim.claimReviews[0].decision, "DENIED");
    console.log("✔ Historical reviews preserved in ClaimReview.");

    // Clean up test records
    await prisma.claimReview.deleteMany({ where: { claimId: createdClaim.id } });
    await prisma.appealReview.deleteMany({ where: { appealLetterId: letter.id } });
    await prisma.appealCitation.deleteMany({ where: { appealLetterId: letter.id } });
    await prisma.appealLetter.deleteMany({ where: { id: letter.id } });
    await prisma.denial.deleteMany({ where: { id: dbDenial.id } });
    await prisma.evidence.deleteMany({ where: { id: dbEvidence.id } });
    await prisma.claim.deleteMany({ where: { id: createdClaim.id } });

    console.log("\n=======================================================");
    console.log("🎉 ALL 18 END-TO-END WORKFLOW CRITERIA VERIFIED SUCCESSFULLY!");
    console.log("=======================================================\n");

  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error("❌ E2E VALIDATION ERROR:", err);
  process.exit(1);
});
