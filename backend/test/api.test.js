import assert from "node:assert/strict";
import path from "node:path";
import { rm } from "node:fs/promises";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/db/prisma.js";

let server;
let baseUrl;
async function call(path, { token, method = "GET", body, formData } = {}) {
  const headers = {};
  if (token) headers.authorization = "Bearer " + token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(baseUrl + path, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(formData ? { body: formData } : {})
  });
  const payload = await response.json();
  return { status: response.status, body: payload };
}
async function login(email, password) {
  return call("/api/auth/login", { method: "POST", body: { email, password } });
}

before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

test("health checks the SQLite database", async () => {
  const result = await call("/api/health");
  assert.equal(result.status, 200);
  assert.equal(result.body.database, "ok");
});

test("login issues JWTs and rejects invalid credentials", async () => {
  const valid = await login("billing.one@example.test", "DemoProvider1!");
  assert.equal(valid.status, 200);
  assert.ok(valid.body.data.token);
  assert.equal(valid.body.data.user.role, "PROVIDER");
  const invalid = await login("billing.one@example.test", "wrong-password");
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.code, "INVALID_CREDENTIALS");
});

test("protected APIs reject missing and malformed bearer tokens", async () => {
  assert.equal((await call("/api/claims")).status, 401);
  assert.equal((await call("/api/claims", { token: "invalid" })).status, 401);
});

test("claims APIs validate input and isolate each owner's records", async () => {
  const userA = (await login("billing.one@example.test", "DemoProvider1!")).body.data.token;
  const userB = (await login("billing.two@example.test", "DemoProvider2!")).body.data.token;
  const aClaims = await call("/api/claims", { token: userA });
  const bClaims = await call("/api/claims", { token: userB });
  assert.equal(aClaims.status, 200);
  assert.equal(aClaims.body.data.pagination.total, 2);
  assert.equal(bClaims.body.data.pagination.total, 1);
  const foreignClaimId = bClaims.body.data.data[0].id;
  assert.equal((await call("/api/claims/" + foreignClaimId, { token: userA })).status, 404);

  const invalid = await call("/api/claims", {
    token: userA, method: "POST",
    body: { claimNumber: "SYN-BAD-1", payerName: "Sample Plan", serviceDate: "2025-01-01T00:00:00.000Z", amount: "3.141" }
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "VALIDATION_ERROR");

  const created = await call("/api/claims", {
    token: userA, method: "POST",
    body: { claimNumber: "SYN-TEST-API-1", payerName: "Sample Plan", serviceDate: "2025-05-01T00:00:00.000Z", amount: "45.70" }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.amount, "45.70");
  assert.equal((await call("/api/claims/" + created.body.data.id, { token: userA })).status, 200);
  assert.equal((await call("/api/claims/" + created.body.data.id, { token: userB })).status, 404);
});

test("denials and evidence are owner-scoped", async () => {
  const userA = (await login("billing.one@example.test", "DemoProvider1!")).body.data.token;
  const userB = (await login("billing.two@example.test", "DemoProvider2!")).body.data.token;
  const aDenials = await call("/api/denials", { token: userA });
  const bDenials = await call("/api/denials", { token: userB });
  assert.equal(aDenials.body.data.pagination.total, 3);
  assert.equal(bDenials.body.data.pagination.total, 1);
  assert.equal((await call("/api/denials/seed-denial-004", { token: userA })).status, 404);

  const reasons = await call("/api/denialreasons", { token: userA });
  assert.equal(reasons.status, 200);
  assert.equal(reasons.body.data.pagination.total, 3);
  assert.ok(reasons.body.data.data[0].evidenceRules.length > 0);

  const evidence = await call("/api/evidences", { token: userA });
  assert.equal(evidence.body.data.pagination.total, 6);
  const foreignClaimId = (await call("/api/claims", { token: userB })).body.data.data[0].id;
  const denied = await call("/api/evidences", {
    token: userA, method: "POST",
    body: { claimId: foreignClaimId, type: "ORDER", sourceLabel: "Synthetic order", summary: "This record must not be attached to another user's claim." }
  });
  assert.equal(denied.status, 404);

  const ownClaimId = (await call("/api/claims", { token: userA })).body.data.data[0].id;
  const created = await call("/api/evidences", {
    token: userA, method: "POST",
    body: { claimId: ownClaimId, type: "OTHER", sourceLabel: "Synthetic added record", summary: "This is a synthetic evidence summary for the authorized claim." }
  });
  assert.equal(created.status, 201);
});

test("document upload and retrieval enforce claim ownership and file types", async () => {
  const userA = (await login("billing.one@example.test", "DemoProvider1!")).body.data.token;
  const userB = (await login("billing.two@example.test", "DemoProvider2!")).body.data.token;
  const ownClaimId = (await call("/api/claims", { token: userA })).body.data.data[0].id;
  const foreignClaimId = (await call("/api/claims", { token: userB })).body.data.data[0].id;

  const foreignUpload = new FormData();
  foreignUpload.append("type", "CLINICAL_NOTE");
  foreignUpload.append("file", new Blob(["%PDF-1.4 synthetic"], { type: "application/pdf" }), "synthetic.pdf");
  const denied = await call(`/api/claims/${foreignClaimId}/documents`, { token: userA, method: "POST", formData: foreignUpload });
  assert.equal(denied.status, 404);

  const invalidUpload = new FormData();
  invalidUpload.append("type", "CLINICAL_NOTE");
  invalidUpload.append("file", new Blob(["synthetic"], { type: "text/plain" }), "synthetic.txt");
  const rejected = await call(`/api/claims/${ownClaimId}/documents`, { token: userA, method: "POST", formData: invalidUpload });
  assert.equal(rejected.status, 415);

  assert.equal((await call(`/api/claims/${foreignClaimId}/documents`, { token: userA })).status, 404);
  assert.equal((await call(`/api/documents?claimId=${foreignClaimId}`, { token: userA })).status, 404);
  assert.equal((await call(`/api/claims/${foreignClaimId}/rag/retrieve`, {
    token: userA, method: "POST", body: { denialId: "seed-denial-004", searchQuery: "synthetic evidence" }
  })).status, 404);
});

test("synthetic PDF upload persists extracted evidence and confirms Chroma indexing", async () => {
  const token = (await login("billing.one@example.test", "DemoProvider1!")).body.data.token;
  const claimId = "seed-claim-001";
  const sourceText = "Synthetic clinic record: the clinician documented intermittent knee pain during the service period.";
  const originalFetch = globalThis.fetch;
  let storageKey;
  let documentId;
  let failIndexOnce = true;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/api/")) return originalFetch(input, init);
    const request = JSON.parse(init.body);
    if (url.pathname.endsWith("/documents/process")) {
      documentId = request.documentId;
      storageKey = request.storageKey;
      return new Response(JSON.stringify({
        documentId, claimId, sourceDocumentName: "synthetic-clinic-note.pdf", pageCount: 1,
        extractedText: sourceText,
        segments: [{ segmentKey: "segment-0001", pageNumber: 1, sectionName: "Assessment", content: sourceText, summary: "Synthetic knee pain note." }],
        chunks: [{ chunkId: "segment-0001-chunk-0001", segmentKey: "segment-0001", pageNumber: 1, sectionName: "Assessment", content: sourceText }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname.endsWith("/documents/index")) {
      if (failIndexOnce) {
        failIndexOnce = false;
        return new Response(JSON.stringify({ detail: "synthetic index outage" }), { status: 503 });
      }
      return new Response(JSON.stringify({ documentId: request.documentId, indexedCount: request.chunks.length }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ detail: "Unexpected synthetic AI test route." }), { status: 404 });
  };

  const formData = new FormData();
  formData.append("claimId", claimId);
  formData.append("type", "CLINICAL_NOTE");
  formData.append("file", new Blob(["%PDF-1.4 synthetic document"], { type: "application/pdf" }), "synthetic-clinic-note.pdf");
  try {
    const uploaded = await call("/api/documents/upload", { token, method: "POST", formData });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    assert.equal(uploaded.body.data.document.status, "INDEXED");
    assert.equal(uploaded.body.data.evidence.length, 1);

    const docs = await call(`/api/documents?claimId=${claimId}`, { token });
    assert.equal(docs.body.data.data[0].id, documentId);
    assert.ok(!("storageKey" in docs.body.data.data[0]));
    assert.equal(await prisma.evidence.count({ where: { documentId, content: sourceText } }), 1);
    assert.equal(docs.body.data.data[0].status, "INDEXED");
    const detail = await call(`/api/documents/${documentId}`, { token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.id, documentId);
    assert.ok(!("storageKey" in detail.body.data));

    await prisma.document.update({ where: { id: documentId }, data: { status: "EXTRACTED" } });
    const retried = await call(`/api/claims/${claimId}/documents/${documentId}/retry`, { token, method: "POST", body: {} });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.data.document.status, "INDEXED");
    assert.equal(retried.body.data.evidence[0].pageNumber, 1);
    assert.equal(await prisma.evidence.count({ where: { documentId, content: sourceText } }), 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (documentId) {
      await prisma.evidence.deleteMany({ where: { documentId } });
      await prisma.document.deleteMany({ where: { id: documentId } });
    }
    if (storageKey) await rm(path.resolve(env.UPLOADS_DIR, storageKey), { force: true });
  }
});

test("appeal generation saves only grounded, claim-owned source citations", async () => {
  const token = (await login("billing.one@example.test", "DemoProvider1!")).body.data.token;
  const claimId = "seed-claim-001";
  const denialId = "seed-denial-001";
  const documentId = "synthetic-rag-document";
  const evidenceId = "synthetic-rag-evidence";
  const sourceReference = `document:${documentId}#segment=segment-0001`;
  const sourceText = "Synthetic clinical source: the clinician documented persistent knee pain during the service period.";
  const statement = "The synthetic clinical source documents persistent knee pain during the service period.";
  await prisma.document.create({ data: {
    id: documentId, claimId, uploadedById: "seed-provider-1", type: "CLINICAL_NOTE",
    originalName: "synthetic-rag-note.pdf", storageKey: "synthetic-rag-storage-key.pdf",
    mimeType: "application/pdf", sizeBytes: 32, status: "INDEXED", pageCount: 1
  } });
  await prisma.evidence.create({ data: {
    id: evidenceId, claimId, createdById: "seed-provider-1", documentId, type: "CLINICAL_NOTE",
    sourceLabel: "synthetic-rag-note.pdf", summary: "Synthetic clinician note.", content: sourceText,
    sourceReference, pageNumber: 1, sectionName: "Assessment"
  } });

  const originalFetch = globalThis.fetch;
  let corruptCitation = false;
  let glmUnavailable = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/api/")) return originalFetch(input, init);
    if (url.pathname.endsWith("/rag/retrieve")) {
      return new Response(JSON.stringify({
        claimId, query: "synthetic search", relevantResultCount: 1,
        results: [{
          chunkId: `${documentId}:chunk-1`, claimId, documentId, evidenceId,
          evidenceType: "CLINICAL_NOTE", sourceDocumentName: "synthetic-rag-note.pdf",
          sourceReference, pageNumber: 1, sectionName: "Assessment", content: sourceText, distance: 0.1
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname.endsWith("/ai/generate-appeal")) {
      if (glmUnavailable) return new Response(JSON.stringify({ detail: "provider unavailable" }), { status: 503 });
      return new Response(JSON.stringify({
        missingEvidence: [],
        appealDraft: {
          subject: "Synthetic grounded appeal", content: statement,
          argumentPoints: [{ text: statement, citationIds: [evidenceId] }],
          citations: [{
            evidenceId, sourceReference: corruptCitation ? "document:wrong-source" : sourceReference,
            sourceLabel: "synthetic-rag-note.pdf", evidenceType: "CLINICAL_NOTE", sourceDate: null,
            excerpt: "the clinician documented persistent knee pain", documentId,
            documentName: "synthetic-rag-note.pdf", pageNumber: 1, sectionName: "Assessment"
          }],
          status: "REQUIRES_CORRECTION", grounded: true, requiresSpecialistReview: true
        },
        validation: { status: "PASSED", grounded: true, facts: [{
          statement, supported: true, evidenceIds: [evidenceId], explanation: "Exact source quote supports the statement."
        }], messages: [] }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ detail: "Unexpected synthetic test route." }), { status: 404 });
  };

  try {
    const valid = await call("/api/ai/run", {
      token, method: "POST", body: { claimId, denialId, searchQuery: "synthetic clinical evidence", generationKey: "550e8400-e29b-41d4-a716-446655440001" }
    });
    assert.equal(valid.status, 201, JSON.stringify(valid.body));
    assert.equal(valid.body.data.saved, true);
    assert.equal(valid.body.data.letter.grounded, true);
    assert.equal(valid.body.data.letter.status, "REQUIRES_CORRECTION");
    assert.equal(valid.body.data.letter.citations[0].evidence.sourceReference, sourceReference);

    const duplicate = await call("/api/ai/run", {
      token, method: "POST", body: { claimId, denialId, searchQuery: "synthetic clinical evidence", generationKey: "550e8400-e29b-41d4-a716-446655440001" }
    });
    assert.equal(duplicate.status, 201);
    assert.equal(duplicate.body.data.reused, true);
    assert.equal(duplicate.body.data.letter.id, valid.body.data.letter.id);

    const reviewerToken = (await login("reviewer.one@example.test", "DemoReviewer1!")).body.data.token;
    const otherToken = (await login("billing.two@example.test", "DemoProvider2!")).body.data.token;
    const savedLetter = valid.body.data.letter;
    const edit = await call(`/api/appealletters/${savedLetter.id}`, {
      token, method: "PATCH", body: {
        content: statement + " [1]", reviewerId: "seed-reviewer-1", expectedUpdatedAt: savedLetter.updatedAt
      }
    });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(edit.body.data.grounded, false);
    assert.equal((await call(`/api/appealletters/${savedLetter.id}`, { token: otherToken })).status, 404);
    const reviewerView = await call(`/api/appealletters/${savedLetter.id}`, { token: reviewerToken });
    assert.equal(reviewerView.status, 200);
    assert.equal(reviewerView.body.data.content, statement + " [1]");

    const approvalMissingAttestation = await call(`/api/appealletters/${savedLetter.id}/approve`, {
      token: reviewerToken, method: "POST", body: { expectedUpdatedAt: edit.body.data.updatedAt }
    });
    assert.equal(approvalMissingAttestation.status, 409);
    const approvalMissingGapAck = await call(`/api/appealletters/${savedLetter.id}/approve`, {
      token: reviewerToken, method: "POST", body: { expectedUpdatedAt: edit.body.data.updatedAt, confirmUnverifiedDraft: true }
    });
    assert.equal(approvalMissingGapAck.status, 409);
    const approved = await call(`/api/appealletters/${savedLetter.id}/approve`, {
      token: reviewerToken, method: "POST", body: {
        expectedUpdatedAt: edit.body.data.updatedAt, confirmUnverifiedDraft: true, acceptMissingEvidence: true
      }
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.status, "APPROVED");
    assert.equal(approved.body.data.reviewer.id, "seed-reviewer-1");
    assert.ok(approved.body.data.reviewedAt);
    assert.equal(approved.body.data.grounded, false);
    const duplicateApproval = await call(`/api/appealletters/${savedLetter.id}/approve`, {
      token: reviewerToken, method: "POST", body: {
        expectedUpdatedAt: approved.body.data.updatedAt, confirmUnverifiedDraft: true, acceptMissingEvidence: true
      }
    });
    assert.equal(duplicateApproval.status, 409);

    corruptCitation = true;
    const before = await prisma.appealLetter.count({ where: { claimId, subject: "Synthetic grounded appeal" } });
    const invalid = await call(`/api/claims/${claimId}/appealletters/generate`, {
      token, method: "POST", body: { denialId, searchQuery: "synthetic clinical evidence", generationKey: "550e8400-e29b-41d4-a716-446655440002" }
    });
    const after = await prisma.appealLetter.count({ where: { claimId, subject: "Synthetic grounded appeal" } });
    assert.equal(invalid.status, 200);
    assert.equal(invalid.body.data.saved, false);
    assert.equal(invalid.body.data.validation.status, "FAILED");
    assert.equal(after, before);

    corruptCitation = false;
    glmUnavailable = true;
    const outage = await call(`/api/claims/${claimId}/appealletters/generate`, {
      token, method: "POST", body: { denialId, searchQuery: "synthetic clinical evidence", generationKey: "550e8400-e29b-41d4-a716-446655440003" }
    });
    assert.equal(outage.status, 503);
    assert.equal(outage.body.code, "AI_SERVICE_UNAVAILABLE");
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.appealLetter.deleteMany({ where: { claimId, subject: "Synthetic grounded appeal" } });
    await prisma.evidence.delete({ where: { id: evidenceId } });
    await prisma.document.delete({ where: { id: documentId } });
  }
});

test("appeal letters are visible to their owner or assigned reviewer only", async () => {
  const provider = (await login("billing.one@example.test", "DemoProvider1!")).body.data.token;
  const reviewer = (await login("reviewer.one@example.test", "DemoReviewer1!")).body.data.token;
  const other = (await login("billing.two@example.test", "DemoProvider2!")).body.data.token;
  const ownerLetters = await call("/api/appealletters", { token: provider });
  const reviewerLetters = await call("/api/appealletters", { token: reviewer });
  const otherLetters = await call("/api/appealletters", { token: other });
  const reviewerWrite = await call("/api/claims", { token: reviewer, method: "POST", body: { claimNumber: "SYN-REVIEW-1", payerName: "Sample Plan", serviceDate: "2025-05-01T00:00:00.000Z", amount: "1.00" } });
  assert.equal(reviewerWrite.status, 403);
  assert.equal(ownerLetters.body.data.pagination.total, 1);
  assert.equal(reviewerLetters.body.data.pagination.total, 1);
  assert.equal(otherLetters.body.data.pagination.total, 0);
  assert.equal(ownerLetters.body.data.data[0].citations.length, 3);
});
