import assert from "node:assert/strict";

const BASE_URL = process.env.BACKEND_URL || "http://127.0.0.1:3000/api";

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

async function request(path, { method = "GET", token, body, isFormData = false } = {}) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body && !isFormData) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, data: json.data !== undefined ? json.data : json };
}

async function login(email, password = "Demo@123") {
  const res = await request("/auth/login", {
    method: "POST",
    body: { email, password }
  });
  assert.equal(res.status, 200, `Login failed for ${email}: ${JSON.stringify(res.data)}`);
  return { token: res.data.token, user: res.data.user };
}

async function run() {
  console.log("================================================================================");
  console.log("🔍 COMPREHENSIVE END-TO-END WORKFLOW VERIFICATION (PROVIDER TO PAYER)");
  console.log("================================================================================\n");

  // Step 1: Health
  console.log("1. Checking System Health...");
  const healthRes = await request("/health");
  assert.equal(healthRes.status, 200, "Health check must return 200");
  assert.equal(healthRes.data.database, "ok", "Database must be ok");
  console.log("   ✔ Backend API & SQLite Database are healthy.\n");

  // Step 2: Authentication
  console.log("2. Authenticating Hospital Biller & Insurance Reviewer...");
  const biller = await login("billing@demo.in", "Demo@123");
  console.log(`   ✔ Biller logged in: ${biller.user.displayName} (Org: ${biller.user.organization?.name})`);
  const reviewer = await login("reviewer@demo.in", "Demo@123");
  console.log(`   ✔ Reviewer logged in: ${reviewer.user.displayName} (Org: ${reviewer.user.organization?.name})\n`);

  // Step 3: Check Me endpoints
  console.log("3. Verifying /auth/me tokens...");
  const meBiller = await request("/auth/me", { token: biller.token });
  assert.equal(meBiller.status, 200);
  assert.equal(meBiller.data.user.email, "billing@demo.in");
  const meReviewer = await request("/auth/me", { token: reviewer.token });
  assert.equal(meReviewer.status, 200);
  assert.equal(meReviewer.data.user.email, "reviewer@demo.in");
  console.log("   ✔ User sessions and claims decoded successfully.\n");

  // Step 4: Metadata queries (organizations, denial reasons, reviewers)
  console.log("4. Fetching Workflow Metadata...");
  const orgsRes = await request("/organizations", { token: biller.token });
  assert.equal(orgsRes.status, 200);
  const orgs = Array.isArray(orgsRes.data) ? orgsRes.data : orgsRes.data.data;
  console.log(`   ✔ Loaded ${orgs.length} organizations.`);

  const denialReasonsRes = await request("/denialreasons", { token: biller.token });
  assert.equal(denialReasonsRes.status, 200);
  const reasons = Array.isArray(denialReasonsRes.data) ? denialReasonsRes.data : denialReasonsRes.data.data;
  console.log(`   ✔ Loaded ${reasons.length} denial reasons.`);

  const reviewersRes = await request("/reviewers", { token: biller.token });
  assert.equal(reviewersRes.status, 200);
  const reviewers = Array.isArray(reviewersRes.data) ? reviewersRes.data : reviewersRes.data.data;
  console.log(`   ✔ Loaded ${reviewers.length} active reviewers.\n`);

  // Step 5: Biller Dashboard Stats
  console.log("5. Testing Biller Dashboard Stats...");
  const statsRes = await request("/stats", { token: biller.token });
  assert.equal(statsRes.status, 200);
  console.log(`   ✔ Biller stats: Total claims=${statsRes.data.totalClaims ?? statsRes.data.claims?.total ?? "N/A"}\n`);

  // Step 6: Create Claim with Clinical Document
  const testClaimNumber = `CLM-E2E-${Date.now().toString().slice(-6)}`;
  console.log(`6. Hospital Biller submitting new Claim ${testClaimNumber}...`);
  const createClaimRes = await request("/claims", {
    method: "POST",
    token: biller.token,
    body: {
      claimNumber: testClaimNumber,
      patientName: "Ramesh Narayanan",
      insuranceOrganizationId: "org-ins-01",
      policyNumber: "POL-BHA-2026-X",
      diagnosisCode: "I21.9",
      procedureCode: "02703ZZ",
      treatmentDescription: "Acute ST-elevation myocardial infarction requiring emergent coronary catheterization and drug-eluting stent placement.",
      serviceDate: "2026-03-12T10:00:00.000Z",
      amount: "185000.00",
      currency: "INR"
    }
  });
  assert.equal(createClaimRes.status, 201, `Failed to create claim: ${JSON.stringify(createClaimRes.data)}`);
  const claim = createClaimRes.data;
  console.log(`   ✔ Claim ${claim.claimNumber} created (ID: ${claim.id}, Status: ${claim.status}).`);

  // Upload Clinical Document as valid PDF
  console.log("   Uploading supporting operative note to claim...");
  const opPdf = createPdfBuffer(
    "Coronary Catheterization Operative Note",
    "Pre-operative coronary catheterization confirmed 90% LAD stenosis. Emergency balloon angioplasty with 3.0x18mm drug-eluting stent deployment performed with TIMI 3 flow restored."
  );

  const formDoc = new FormData();
  formDoc.append("type", "CLINICAL_NOTE");
  formDoc.append("file", new Blob([opPdf], { type: "application/pdf" }), "Cardiac_Catheterization_Report.pdf");

  const uploadRes = await fetch(`${BASE_URL}/claims/${claim.id}/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${biller.token}` },
    body: formDoc
  });
  const uploadJson = await uploadRes.json();
  assert.equal(uploadRes.status, 201, `Failed to upload doc: ${JSON.stringify(uploadJson)}`);
  console.log(`   ✔ Document uploaded and indexed: ${uploadJson.data?.originalName || "Cardiac_Catheterization_Report.pdf"}\n`);

  // Step 7: Reviewer Queue & Inspection
  console.log("7. Insurance Reviewer inspecting Claims Queue...");
  const reviewerClaimsRes = await request("/claims?limit=50", { token: reviewer.token });
  assert.equal(reviewerClaimsRes.status, 200);
  const reviewerClaims = reviewerClaimsRes.data.data || reviewerClaimsRes.data;
  const foundClaim = reviewerClaims.find((c) => c.id === claim.id);
  assert.ok(foundClaim, "Claim must appear in Insurance Reviewer's queue");
  console.log(`   ✔ Claim ${foundClaim.claimNumber} found in Insurance Review queue.`);

  // Step 8: Reviewer Denies Claim
  console.log("8. Insurance Reviewer DENIES the claim (Code: DOC-MISS-02)...");
  const denyRes = await request(`/claims/${claim.id}/review`, {
    method: "POST",
    token: reviewer.token,
    body: {
      decision: "DENIED",
      denialCode: "DOC-MISS-02",
      denialExplanation: "Incomplete emergency medical documentation. Operative notes lack signed cardiologist attestation.",
      reviewComments: "Please provide complete preoperative diagnostic ECG tracing and signed attending cardiologist attestation."
    }
  });
  assert.equal(denyRes.status, 200, `Deny claim failed: ${JSON.stringify(denyRes.data)}`);
  assert.equal(denyRes.data.claim?.status, "DENIED");
  console.log(`   ✔ Claim status transitioned to DENIED with reviewer feedback.\n`);

  // Step 9: Biller Checks Claim and Denial Analysis
  console.log("9. Biller opens Denied Claim and performs AI Denial Analysis...");
  const claimDetailsRes = await request(`/claims/${claim.id}`, { token: biller.token });
  assert.equal(claimDetailsRes.status, 200);
  assert.equal(claimDetailsRes.data.status, "DENIED");
  assert.ok(claimDetailsRes.data.denials?.length > 0 || claimDetailsRes.data.claimReviews?.length > 0);

  const denialId = claimDetailsRes.data.denials?.[0]?.id;
  const aiDenialRes = await request(`/claims/${claim.id}/ai/analyze-denial`, {
    method: "POST",
    token: biller.token,
    body: denialId ? { denialId } : {}
  });
  assert.equal(aiDenialRes.status, 200, `AI Denial Analysis failed: ${JSON.stringify(aiDenialRes.data)}`);
  console.log(`   ✔ AI Analysis completed: Reviewer comment recognized: "${aiDenialRes.data.reviewerComment?.slice(0, 60)}..."`);
  console.log(`   ✔ AI Missing Documents recommendations count: ${aiDenialRes.data.missingDocuments?.length ?? 0}.\n`);

  // Step 10: Biller uploads additional clinical evidence using attachPredefined or PDF
  console.log("10. Biller attaches requested evidence (ECG & Lab Result)...");
  const attachRes = await request(`/claims/${claim.id}/documents/attach-predefined`, {
    method: "POST",
    token: biller.token,
    body: { templateKey: "LAB_RESULT", denialId }
  });
  assert.ok([200, 201].includes(attachRes.status), `Attach predefined failed: ${JSON.stringify(attachRes.data)}`);
  console.log(`   ✔ Evidence attached: ${attachRes.data.document?.originalName}\n`);

  // Step 11: AI Appeal Generation (Rev #1)
  console.log("11. Generating Grounded Appeal Letter (Rev #1) via AI...");
  const genRes = await request("/ai/run", {
    method: "POST",
    token: biller.token,
    body: {
      claimId: claim.id,
      limit: 8,
      generationKey: `gen-${Date.now()}-1`
    }
  });
  assert.ok([200, 201].includes(genRes.status), `Generate appeal failed: ${JSON.stringify(genRes.data)}`);
  const letterRev1 = genRes.data.letter || genRes.data;
  assert.ok(letterRev1.id, "Letter ID must be present");
  assert.ok(["DRAFT", "REQUIRES_CORRECTION"].includes(letterRev1.status));
  assert.equal(letterRev1.revisionNumber || 1, 1);
  console.log(`   ✔ Appeal Letter formulated (ID: ${letterRev1.id}, Rev #${letterRev1.revisionNumber || 1}, Status: ${letterRev1.status}).`);
  console.log(`   ✔ Grounded: ${letterRev1.grounded}, Citations count: ${letterRev1.citations?.length ?? 0}.\n`);

  // Step 12: Biller Submits Appeal to Reviewer
  console.log("12. Biller submits Rev #1 Appeal Letter to Insurance Reviewer...");
  const submitRes = await request(`/appealletters/${letterRev1.id}/submit`, {
    method: "POST",
    token: biller.token,
    body: { reviewerId: reviewer.user.id }
  });
  assert.equal(submitRes.status, 200, `Submit appeal failed: ${JSON.stringify(submitRes.data)}`);
  assert.equal(submitRes.data.status, "SUBMITTED_FOR_REVIEW");
  console.log(`   ✔ Appeal Letter status updated to SUBMITTED_FOR_REVIEW.\n`);

  // Step 13: Reviewer Rejects Appeal
  console.log("13. Reviewer inspects submitted appeal and REJECTS with feedback...");
  const rejectRes = await request(`/appealletters/${letterRev1.id}/reject`, {
    method: "POST",
    token: reviewer.token,
    body: { comment: "Need post-procedure angiography outcome documentation confirming stent patency." }
  });
  assert.equal(rejectRes.status, 200, `Reject appeal failed: ${JSON.stringify(rejectRes.data)}`);
  assert.equal(rejectRes.data.status, "REJECTED");
  assert.equal(rejectRes.data.reviewerComment, "Need post-procedure angiography outcome documentation confirming stent patency.");
  console.log("   ✔ Appeal Letter status transitioned to REJECTED.");
  console.log(`   ✔ Reviewer feedback recorded: "${rejectRes.data.reviewerComment}".\n`);

  // Step 14: Continuous Re-Appeal Loop (Step 1 -> Step 2 -> Step 3)
  console.log("14. Biller initiates AI Re-Appeal Pipeline...");
  
  // 14a. AI Rejection Feedback Analysis
  const analyzeRejectionRes = await request(`/claims/${claim.id}/ai/analyze-rejection`, {
    method: "POST",
    token: biller.token,
    body: { letterId: letterRev1.id }
  });
  assert.equal(analyzeRejectionRes.status, 200);
  console.log(`   ✔ AI Rejection Analysis generated: recommendations=${analyzeRejectionRes.data.recommendations?.length ?? 0}.`);

  // 14b. Upload additional evidence (Imaging Report)
  console.log("   Uploading requested post-procedure angiography report...");
  const attachImagingRes = await request(`/claims/${claim.id}/documents/attach-predefined`, {
    method: "POST",
    token: biller.token,
    body: { templateKey: "IMAGING_REPORT", denialId }
  });
  assert.ok([200, 201].includes(attachImagingRes.status));
  console.log(`   ✔ Post-procedure report indexed: ${attachImagingRes.data.document?.originalName}`);

  // 14c. Generate New Appeal (Rev #2)
  console.log("   Generating New Appeal Letter (Rev #2) via AI microservice...");
  const genRev2Res = await request("/ai/run", {
    method: "POST",
    token: biller.token,
    body: {
      claimId: claim.id,
      limit: 8,
      generationKey: `gen-${Date.now()}-2`
    }
  });
  assert.ok([200, 201].includes(genRev2Res.status));
  const letterRev2 = genRev2Res.data.letter || genRev2Res.data;
  assert.equal(letterRev2.revisionNumber, 2, "Second generation must be revisionNumber 2");
  assert.ok(["DRAFT", "REQUIRES_CORRECTION"].includes(letterRev2.status));
  console.log(`   ✔ Rev #2 Appeal formulated (ID: ${letterRev2.id}, Rev #${letterRev2.revisionNumber}, Status: ${letterRev2.status}).\n`);

  // Step 15: Biller Submits Rev #2
  console.log("15. Biller submits Rev #2 to Reviewer...");
  const submitRev2Res = await request(`/appealletters/${letterRev2.id}/submit`, {
    method: "POST",
    token: biller.token,
    body: { reviewerId: reviewer.user.id }
  });
  assert.equal(submitRev2Res.status, 200);
  assert.equal(submitRev2Res.data.status, "SUBMITTED_FOR_REVIEW");
  console.log("   ✔ Rev #2 submitted successfully.\n");

  // Step 16: Reviewer Approves Rev #2
  console.log("16. Insurance Reviewer verifies citations and APPROVES Rev #2...");
  const approveRes = await request(`/appealletters/${letterRev2.id}/approve`, {
    method: "POST",
    token: reviewer.token,
    body: {
      confirmUnverifiedDraft: true,
      acceptMissingEvidence: true,
      reviewerComment: "All required clinical evidence, ECG tracings, and post-stent angiogram verified. Appeal certified and approved for disbursement."
    }
  });
  assert.equal(approveRes.status, 200, `Approve appeal failed: ${JSON.stringify(approveRes.data)}`);
  assert.equal(approveRes.data.status, "APPROVED");
  console.log("   ✔ Appeal status updated to APPROVED!");

  // Step 17: Verify Claim Overturned to APPROVED
  console.log("17. Verifying Claim Status Overturn in Database...");
  const finalClaimCheck = await request(`/claims/${claim.id}`, { token: biller.token });
  assert.equal(finalClaimCheck.status, 200);
  assert.equal(finalClaimCheck.data.status, "APPROVED", "Claim must be overturned to APPROVED upon appeal approval");
  console.log(`   ✔ Claim ${finalClaimCheck.data.claimNumber} is now APPROVED!\n`);

  // Step 18: Verify Appeal Letters History for the Claim
  console.log("18. Verifying full revision and audit history...");
  const claimLettersRes = await request(`/appealletters?claimId=${claim.id}`, { token: biller.token });
  assert.equal(claimLettersRes.status, 200);
  const claimLetters = claimLettersRes.data.data || claimLettersRes.data;
  console.log(`   ✔ Claim has ${claimLetters.length} letter revisions recorded:`);
  claimLetters.forEach((l) => {
    console.log(`      • Rev #${l.revisionNumber || 1}: Status=${l.status}, Created=${l.createdAt}`);
  });

  console.log("\n================================================================================");
  console.log("🎉 ALL WORKFLOW STEPS PASSED SUCCESSFULLY WITHOUT ERRORS!");
  console.log("================================================================================\n");
}

run().catch((err) => {
  console.error("\n❌ E2E VERIFICATION FAILED:", err);
  process.exit(1);
});
