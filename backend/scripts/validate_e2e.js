import assert from "node:assert/strict";
import { prisma } from "../src/db/prisma.js";

const BASE_URL = process.env.BACKEND_URL || "http://127.0.0.1:3000/api";

async function api(path, { method = "GET", token, body } = {}) {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const headers = {};
  if (token) headers["Authorization"] = "Bearer " + token;
  if (body && !isFormData) headers["Content-Type"] = "application/json";

  const res = await fetch(BASE_URL + path, {
    method,
    headers,
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined
  });

  const payload = await res.json().catch(() => ({}));
  return { status: res.status, body: payload };
}

async function login(email, password = "Demo@123") {
  const res = await api("/auth/login", {
    method: "POST",
    body: { email, password }
  });
  assert.equal(res.status, 200, `Login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function run() {
  console.log("=== 1. System Health Check ===");
  const health = await api("/health");
  assert.equal(health.status, 200, "Health check failed");
  assert.equal(health.body.database, "ok");
  console.log("✔ Backend SQLite Database is healthy.");

  console.log("\n=== 2. Demo User Authentication & Roles ===");
  const admin = await login("admin@demo.in");
  assert.equal(admin.user.role, "ADMIN");
  console.log(`✔ Admin logged in: ${admin.user.displayName} (${admin.user.role})`);

  const billing = await login("billing@demo.in");
  assert.equal(billing.user.role, "BILLING_SPECIALIST");
  console.log(`✔ Billing Specialist logged in: ${billing.user.displayName} (${billing.user.role})`);

  const reviewer = await login("reviewer@demo.in");
  assert.ok(["REVIEWER", "COMPLIANCE_REVIEWER"].includes(reviewer.user.role));
  console.log(`✔ Reviewer logged in: ${reviewer.user.displayName} (${reviewer.user.role})`);

  console.log("\n=== 3. GET /auth/me Verification ===");
  const meAdmin = await api("/auth/me", { token: admin.token });
  assert.equal(meAdmin.status, 200);
  assert.equal(meAdmin.body.data.user.email, "admin@demo.in");
  console.log("✔ GET /auth/me verified for authenticated sessions.");

  console.log("\n=== 4. Role Authorization Boundaries & Enforcements ===");
  // Billing specialist trying to access Admin endpoints must receive 403
  const unauthorizedAdmin = await api("/admin/users", { token: billing.token });
  assert.equal(unauthorizedAdmin.status, 403, "Specialist should not access /admin/users");
  console.log("✔ Billing specialist denied access to admin users endpoint (403 Forbidden).");

  // Reviewer trying to create claims must receive 403
  const reviewerClaimCreate = await api("/claims", {
    method: "POST",
    token: reviewer.token,
    body: { claimNumber: "CLM-REV-ILLEGAL", payerName: "Test", serviceDate: new Date().toISOString(), amount: "1000.00" }
  });
  assert.equal(reviewerClaimCreate.status, 403, "Reviewer must not create claims");
  console.log("✔ Reviewer denied permission to create claims (403 Forbidden).");

  console.log("\n=== 5. Admin Capabilities: Statistics & User Management ===");
  const stats = await api("/admin/stats", { token: admin.token });
  assert.equal(stats.status, 200);
  console.log(`✔ Admin stats retrieved: ${stats.body.data.claims.total} total claims, ${stats.body.data.users.total} total users.`);

  // Create a new user as Admin
  const uniqueEmail = `test.specialist.${Date.now()}@demo.in`;
  const createdUserRes = await api("/admin/users", {
    method: "POST",
    token: admin.token,
    body: {
      email: uniqueEmail,
      displayName: "Deepak Joshi",
      role: "BILLING_SPECIALIST",
      password: "TestPassword123"
    }
  });
  assert.equal(createdUserRes.status, 201);
  const createdUserId = createdUserRes.body.data.id;
  console.log(`✔ Admin created new user: ${createdUserRes.body.data.displayName} (${createdUserRes.body.data.email})`);

  // Toggle user status (deactivate)
  const deactRes = await api(`/admin/users/${createdUserId}/status`, {
    method: "PATCH",
    token: admin.token,
    body: { active: false }
  });
  assert.equal(deactRes.status, 200);
  assert.equal(deactRes.body.data.active, false);
  console.log("✔ Admin deactivated user account.");

  // Deactivated user cannot log in
  const loginDeact = await api("/auth/login", {
    method: "POST",
    body: { email: uniqueEmail, password: "TestPassword123" }
  });
  assert.equal(loginDeact.status, 401);
  console.log("✔ Deactivated user blocked from logging in (401).");

  console.log("\n=== 6. Billing Specialist Workflow: Indian Claims, Denial & RAG Appeal Draft ===");
  const claimsRes = await api("/claims", { token: billing.token });
  assert.equal(claimsRes.status, 200);
  const indianClaims = claimsRes.body.data.data;
  console.log(`✔ Specialist loaded ${indianClaims.length} authorized claims. First: ${indianClaims[0]?.claimNumber} (${indianClaims[0]?.patientName})`);

  const clm1001 = indianClaims.find((c) => c.claimNumber === "CLM-1001");
  assert.ok(clm1001, "CLM-1001 must exist");
  assert.equal(clm1001.currency, "INR");
  console.log(`✔ Verified INR currency on ${clm1001.claimNumber}: ₹${clm1001.amount} at ${clm1001.hospitalName}`);

  // Retrieve denial for CLM-1001
  const denialRes = await api(`/claims/${clm1001.id}`, { token: billing.token });
  assert.equal(denialRes.status, 200);
  const claimData = denialRes.body.data;
  const denial = claimData.denials[0];
  assert.ok(denial, "Denial must exist on CLM-1001");
  console.log(`✔ Denial inspected: ${denial.denialReason.code} - ${denial.denialReason.title}`);

  // RAG retrieval test for CLM-1001
  const ragRes = await api(`/claims/${clm1001.id}/rag/retrieve`, {
    method: "POST",
    token: billing.token,
    body: {
      denialId: denial.id,
      searchQuery: "knee arthroplasty surgical justification and clinical notes",
      limit: 5
    }
  });
  assert.equal(ragRes.status, 200, `RAG retrieval failed: ${JSON.stringify(ragRes.body)}`);
  console.log(`✔ Persistent ChromaDB RAG retrieval succeeded: ${ragRes.body.data.results.length} chunks retrieved.`);

  // Update Appeal Letter Draft
  await prisma.appealLetter.updateMany({
    where: { claim: { claimNumber: "CLM-1001" } },
    data: { status: "DRAFT", reviewerComment: null }
  });
  const appealLettersRes = await api(`/appealletters?claimId=${clm1001.id}`, { token: billing.token });
  assert.equal(appealLettersRes.status, 200);
  let letter = appealLettersRes.body.data.data?.[0];
  assert.ok(letter, "Letter must exist for CLM-1001");

  const updatedContent = letter.content + "\n\n[Addendum: Additional orthopedic clinical notes attached for revision.]";
  const updateRes = await api(`/appealletters/${letter.id}`, {
    method: "PATCH",
    token: billing.token,
    body: {
      content: updatedContent,
      reviewerId: reviewer.user.id,
      expectedUpdatedAt: letter.updatedAt
    }
  });
  assert.equal(updateRes.status, 200);
  letter = updateRes.body.data;
  console.log("✔ Specialist updated draft and assigned reviewer.");

  // Submit for Review
  const submitRes = await api(`/appealletters/${letter.id}/submit`, {
    method: "POST",
    token: billing.token,
    body: { reviewerId: reviewer.user.id }
  });
  assert.equal(submitRes.status, 200);
  letter = submitRes.body.data;
  assert.equal(letter.status, "SUBMITTED_FOR_REVIEW");
  console.log(`✔ Specialist submitted appeal letter for review. Status: ${letter.status}`);

  console.log("\n=== 7. Reviewer Workflow: Review Queue, Rejection with Mandatory Comment, & Final Approval ===");
  // Reviewer views review queue
  const reviewerLetters = await api("/appealletters", { token: reviewer.token });
  assert.equal(reviewerLetters.status, 200);
  const inQueue = reviewerLetters.body.data.data.find((l) => l.id === letter.id);
  assert.ok(inQueue, "Letter must appear in reviewer queue");
  console.log(`✔ Reviewer inspected queue: found ${letter.id} in status ${inQueue.status}`);

  // Specialist attempts self-approval -> must fail
  const selfApprove = await api(`/appealletters/${letter.id}/approve`, {
    method: "POST",
    token: billing.token,
    body: { confirmUnverifiedDraft: true }
  });
  assert.equal(selfApprove.status, 403, "Specialist must not approve their own letter");
  console.log("✔ Specialist prevented from self-approving appeal (403 Forbidden).");

  // Reviewer attempts rejection without comment -> must fail
  const emptyReject = await api(`/appealletters/${letter.id}/reject`, {
    method: "POST",
    token: reviewer.token,
    body: { comment: "" }
  });
  assert.equal(emptyReject.status, 400, "Rejection requires mandatory comment");
  console.log("✔ Rejection without comment rejected by validation (400 Bad Request).");

  // Reviewer rejects with comment
  const rejectRes = await api(`/appealletters/${letter.id}/reject`, {
    method: "POST",
    token: reviewer.token,
    body: { comment: "Please cite the radiologist report date on page 2 before approval." }
  });
  assert.equal(rejectRes.status, 200);
  letter = rejectRes.body.data;
  assert.equal(letter.status, "REJECTED");
  assert.equal(letter.reviewerComment, "Please cite the radiologist report date on page 2 before approval.");
  console.log(`✔ Reviewer rejected appeal with feedback: "${letter.reviewerComment}". Status: ${letter.status}`);

  // Specialist views feedback and revises draft
  const specialistView = await api(`/appealletters/${letter.id}`, { token: billing.token });
  assert.equal(specialistView.status, 200);
  assert.equal(specialistView.body.data.status, "REJECTED");
  console.log(`✔ Specialist verified reviewer rejection comment: "${specialistView.body.data.reviewerComment}"`);

  // Specialist revises letter and resubmits
  const revisedRes = await api(`/appealletters/${letter.id}`, {
    method: "PATCH",
    token: billing.token,
    body: {
      content: letter.content + "\n\nRadiologist Report Date: 2025-01-18 verified.",
      reviewerId: reviewer.user.id,
      expectedUpdatedAt: letter.updatedAt
    }
  });
  assert.equal(revisedRes.status, 200);

  const resubmitRes = await api(`/appealletters/${letter.id}/submit`, {
    method: "POST",
    token: billing.token,
    body: { reviewerId: reviewer.user.id }
  });
  assert.equal(resubmitRes.status, 200);
  letter = resubmitRes.body.data;
  assert.equal(letter.status, "SUBMITTED_FOR_REVIEW");
  console.log(`✔ Specialist resubmitted appeal for review. Status: ${letter.status}`);

  // Reviewer approves the appeal
  const approveRes = await api(`/appealletters/${letter.id}/approve`, {
    method: "POST",
    token: reviewer.token,
    body: {
      expectedUpdatedAt: letter.updatedAt,
      confirmUnverifiedDraft: true,
      acceptMissingEvidence: false
    }
  });
  assert.equal(approveRes.status, 200);
  letter = approveRes.body.data;
  assert.equal(letter.status, "APPROVED");
  assert.ok(letter.reviewedAt, "reviewedAt timestamp must be recorded");
  console.log(`✔ Reviewer approved appeal! Status: ${letter.status}, Approved at: ${letter.reviewedAt}`);

  console.log("\n=======================================================");
  console.log("🎉 ALL END-TO-END WORKFLOW INTEGRATION CHECKS PASSED!");
  console.log("=======================================================");
}

run().catch((err) => {
  console.error("❌ E2E Validation Error:", err);
  process.exit(1);
});
