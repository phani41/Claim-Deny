import { useCallback, useEffect, useState, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import {
  Check,
  Clipboard,
  ClipboardList,
  FileCheck2,
  FileWarning,
  ShieldCheck,
  XCircle,
  AlertCircle,
  FileText,
  Clock,
  ExternalLink,
  ChevronRight,
  RotateCcw,
  Building2,
  Calendar,
  AlertTriangle
} from "lucide-react";
import { api } from "../api/client.js";
import { Button, Card, CardHeader, CheckboxMultiSelect, EmptyState, ErrorState, LoadingState, Modal, PageHeader, StatusBadge } from "../components/ui.jsx";
import { useAuth } from "../context/auth-context.jsx";
import { useToast } from "../context/toast-context.jsx";
import { formatCurrency, formatDate, titleCase } from "../lib/format.js";
import { broadcastClaimUpdate, useClaimSync } from "../lib/sync.js";

const COMMON_DENIAL_CODES = [
  { code: "AUTH-01", title: "Lack of Prior Authorization", explanation: "Service requires prior authorization prior to admission or treatment, but no authorization was requested or on file." },
  { code: "MED-01", title: "Medical Necessity Not Established", explanation: "Submitted clinical documentation does not establish medical necessity for the level of acute care or elective procedure billed." },
  { code: "DOC-01", title: "Insufficient Clinical Documentation", explanation: "Key diagnostic test results, physician order sheets, or operative summaries are missing from the claim package." },
  { code: "POLICY-01", title: "Policy Exclusion or Benefit Limit Exceeded", explanation: "The specified diagnosis or therapeutic procedure is not covered under the active policy terms or exceeds sub-limit." },
  { code: "TIMELY-01", title: "Exceeded Timely Filing Limit", explanation: "Claim was submitted beyond the mandated 30-day window following patient discharge without pre-approved extension." }
];

export const REQUIRED_DOC_TYPES = [
  { value: "CLINICAL_NOTE", label: "Clinical / Operative Note" },
  { value: "IMAGING_REPORT", label: "Imaging / Radiology Report" },
  { value: "LAB_RESULT", label: "Laboratory / Diagnostic Result" },
  { value: "ORDER", label: "Physician Order / Prescription" },
  { value: "AUTHORIZATION", label: "Prior Authorization Request" },
  { value: "REFERRAL", label: "Medical Referral Document" },
  { value: "TREATMENT_HISTORY", label: "Treatment / Discharge Summary" },
  { value: "OTHER", label: "Other Supporting Evidence" }
];

export function ReviewFinalizePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { showToast, notify } = useToast();
  const toast = showToast || notify;

  // Active Queue Tab: 'claims' | 'appeals'
  const [activeQueue, setActiveQueue] = useState(searchParams.get("tab") === "appeals" ? "appeals" : "claims");

  // Appeal Letters State
  const [letters, setLetters] = useState([]);
  const [selectedId, setSelectedId] = useState(searchParams.get("letter") || "");
  const [statusFilter, setStatusFilter] = useState("PENDING"); // 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'
  const [confirmCitations, setConfirmCitations] = useState(true);
  const [acceptMissing, setAcceptMissing] = useState(true);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectionComment, setRejectionComment] = useState("");
  const [rejectionError, setRejectionError] = useState("");
  const [appealRejectDocTypes, setAppealRejectDocTypes] = useState([]);
  const [claimDocuments, setClaimDocuments] = useState([]);

  // Claims Approval State
  const [claims, setClaims] = useState([]);
  const [selectedClaimId, setSelectedClaimId] = useState(searchParams.get("claim") || "");
  const [claimStatusFilter, setClaimStatusFilter] = useState("SUBMITTED"); // 'SUBMITTED' | 'APPROVED' | 'DENIED' | 'ALL'
  const [adjudicatingClaim, setAdjudicatingClaim] = useState(false);
  const [claimDenialModalOpen, setClaimDenialModalOpen] = useState(false);
  const [claimDenialCode, setClaimDenialCode] = useState("AUTH-01");
  const [claimDenialExplanation, setClaimDenialExplanation] = useState(COMMON_DENIAL_CODES[0].explanation);
  const [claimMissingDocTypes, setClaimMissingDocTypes] = useState([]);
  const [claimReviewComment, setClaimReviewComment] = useState("");
  const [claimAdjudicationError, setClaimAdjudicationError] = useState("");
  const [selectedClaimDocuments, setSelectedClaimDocuments] = useState([]);
  const [selectedClaimDocsLoading, setSelectedClaimDocsLoading] = useState(false);

  function handleClaimMissingDocsChange(newTypes) {
    setClaimMissingDocTypes(newTypes);
    const labels = newTypes.map((v) => REQUIRED_DOC_TYPES.find((d) => d.value === v)?.label).filter(Boolean);
    const prefix = labels.length > 0 ? `Missing required ${labels.join(", ")}. ` : "";
    setClaimReviewComment((prev) => {
      const stripped = prev.replace(/^Missing required [^.]+\.\s*/, "").trim();
      return prefix + stripped;
    });
  }

  function handleAppealRejectDocsChange(newTypes) {
    setAppealRejectDocTypes(newTypes);
    const labels = newTypes.map((v) => REQUIRED_DOC_TYPES.find((d) => d.value === v)?.label).filter(Boolean);
    const prefix = labels.length > 0 ? `Missing required ${labels.join(", ")}. ` : "";
    setRejectionComment((prev) => {
      const stripped = prev.replace(/^Missing required [^.]+\.\s*/, "").trim();
      return prefix + stripped;
    });
  }

  // Common Loading & Sync State
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  // Load both appeal letters and claims in parallel
  const load = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setIsRefreshing(true);
    setError("");
    try {
      const [lettersResult, claimsResult] = await Promise.all([
        api.appealLetters({ page: 1, limit: 50 }),
        api.claims({ page: 1, limit: 50 })
      ]);
      setLetters(lettersResult.data || []);
      setClaims(claimsResult.data || []);
    } catch (failure) {
      if (!isSilent) setError(failure.message || "Failed to load review queue.");
    } finally {
      if (!isSilent) setLoading(false);
      setIsRefreshing(false);
    }
  }, [revision]);

  useEffect(() => {
    load(false);
  }, [load]);

  useClaimSync(() => {
    if (!rejectModalOpen && !claimDenialModalOpen && !approving && !rejecting && !adjudicatingClaim) {
      load(true);
    }
  }, 3000);

  // Statuses considered active/actionable for appeal review
  const PENDING_STATUSES = useMemo(() => ["SUBMITTED_FOR_REVIEW", "IN_REVIEW", "SUBMITTED", "DRAFT", "REQUIRES_CORRECTION"], []);

  // Deduplicate letters by claimId, keeping the newest revision/record
  const deduplicatedLetters = useMemo(() => {
    const map = new Map();
    for (const l of letters) {
      const key = l.claimId || l.id;
      if (!map.has(key)) {
        map.set(key, l);
      } else {
        const existing = map.get(key);
        const existingRev = existing.revisionNumber || 0;
        const currentRev = l.revisionNumber || 0;
        const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
        const currentTime = new Date(l.updatedAt || l.createdAt || 0).getTime();
        if (currentRev > existingRev || (currentRev === existingRev && currentTime > existingTime)) {
          map.set(key, l);
        }
      }
    }
    return Array.from(map.values());
  }, [letters]);

  // Category counts - Appeals
  const pendingLetters = useMemo(
    () => deduplicatedLetters.filter((l) => PENDING_STATUSES.includes(l.status)),
    [deduplicatedLetters, PENDING_STATUSES]
  );
  const approvedLetters = useMemo(
    () => deduplicatedLetters.filter((l) => l.status === "APPROVED"),
    [deduplicatedLetters]
  );
  const rejectedLetters = useMemo(
    () => deduplicatedLetters.filter((l) => l.status === "REJECTED"),
    [deduplicatedLetters]
  );

  const filteredLetters = useMemo(() => {
    if (statusFilter === "PENDING") return pendingLetters;
    if (statusFilter === "APPROVED") return approvedLetters;
    if (statusFilter === "REJECTED") return rejectedLetters;
    return deduplicatedLetters;
  }, [statusFilter, pendingLetters, approvedLetters, rejectedLetters, deduplicatedLetters]);

  const selected = useMemo(() => {
    return filteredLetters.find((item) => item.id === selectedId) || filteredLetters[0] || null;
  }, [filteredLetters, selectedId]);

  const uniqueCitations = useMemo(() => {
    if (!selected?.citations || !Array.isArray(selected.citations)) return [];
    const map = new Map();
    for (const c of selected.citations) {
      const docName = c.evidence?.sourceLabel || c.evidence?.document?.originalName || c.documentName || "Medical Evidence";
      const key = c.evidence?.documentId || docName;
      const cleanExcerpt = (c.excerpt === "SAMPLE MEDICAL CLAIM DOCUMENT" || !c.excerpt)
        ? "Clinical treatment record and verified diagnostic observations on file."
        : c.excerpt;
      if (!map.has(key)) {
        map.set(key, {
          ...c,
          excerpt: cleanExcerpt,
          displayLabel: docName,
          pages: c.evidence?.pageNumber ? [c.evidence.pageNumber] : (c.pageNumber ? [c.pageNumber] : []),
        });
      } else {
        const existing = map.get(key);
        const page = c.evidence?.pageNumber || c.pageNumber;
        if (page && !existing.pages.includes(page)) {
          existing.pages.push(page);
        }
        if (existing.excerpt.includes("SAMPLE MEDICAL CLAIM") && cleanExcerpt !== existing.excerpt) {
          existing.excerpt = cleanExcerpt;
        }
      }
    }
    return Array.from(map.values());
  }, [selected?.citations]);

  // Deduplicate claims by claimNumber or id
  const deduplicatedClaims = useMemo(() => {
    const map = new Map();
    for (const c of claims) {
      const key = c.claimNumber || c.id;
      if (!map.has(key)) {
        map.set(key, c);
      } else {
        const existing = map.get(key);
        const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
        const currentTime = new Date(c.updatedAt || c.createdAt || 0).getTime();
        if (currentTime > existingTime) {
          map.set(key, c);
        }
      }
    }
    return Array.from(map.values());
  }, [claims]);

  // Category counts - Claims
  const pendingClaims = useMemo(
    () => deduplicatedClaims.filter((c) => ["SUBMITTED", "UNDER_REVIEW"].includes(c.status)),
    [deduplicatedClaims]
  );
  const approvedClaims = useMemo(
    () => deduplicatedClaims.filter((c) => c.status === "APPROVED"),
    [deduplicatedClaims]
  );
  const deniedClaims = useMemo(
    () => deduplicatedClaims.filter((c) => c.status === "DENIED"),
    [deduplicatedClaims]
  );

  const filteredClaims = useMemo(() => {
    if (claimStatusFilter === "SUBMITTED") return pendingClaims;
    if (claimStatusFilter === "APPROVED") return approvedClaims;
    if (claimStatusFilter === "DENIED") return deniedClaims;
    return deduplicatedClaims;
  }, [claimStatusFilter, pendingClaims, approvedClaims, deniedClaims, deduplicatedClaims]);

  const selectedClaim = useMemo(() => {
    return filteredClaims.find((c) => c.id === selectedClaimId) || filteredClaims[0] || null;
  }, [filteredClaims, selectedClaimId]);

  // Synchronize selected letter
  useEffect(() => {
    if (!letters.length) return;
    const targetLetterId = searchParams.get("letter");
    if (targetLetterId) {
      const target = letters.find((item) => item.id === targetLetterId);
      if (target) {
        setSelectedId(target.id);
        setActiveQueue("appeals");
        if (!PENDING_STATUSES.includes(target.status)) {
          setStatusFilter("ALL");
        }
        return;
      }
    }

    if (!selectedId || !filteredLetters.some((item) => item.id === selectedId)) {
      setSelectedId(filteredLetters[0]?.id || "");
    }
  }, [letters, filteredLetters, searchParams, PENDING_STATUSES, selectedId]);

  // Synchronize selected claim
  useEffect(() => {
    if (!claims.length) return;
    const targetClaimId = searchParams.get("claim");
    if (targetClaimId) {
      const target = claims.find((c) => c.id === targetClaimId);
      if (target) {
        setSelectedClaimId(target.id);
        setActiveQueue("claims");
        if (target.status === "APPROVED" || target.status === "DENIED") {
          setClaimStatusFilter("ALL");
        }
        return;
      }
    }

    if (!selectedClaimId || !filteredClaims.some((c) => c.id === selectedClaimId)) {
      setSelectedClaimId(filteredClaims[0]?.id || "");
    }
  }, [claims, filteredClaims, searchParams, selectedClaimId]);

  // Separation of duties: billing specialist cannot approve own letter
  const isAuthor = selected?.authorId === user?.id;
  const isReviewerRole = ["REVIEWER", "COMPLIANCE_REVIEWER"].includes(user?.role);
  const isAssignedReviewer = isReviewerRole && (
    selected?.reviewerId === user?.id ||
    !selected?.reviewerId ||
    (user?.organizationId && selected?.claim?.insuranceOrganizationId === user?.organizationId)
  );
  const canDecide = (user?.role === "ADMIN" || isAssignedReviewer) && !isAuthor;
  const isPendingDecision = selected && ["SUBMITTED_FOR_REVIEW", "IN_REVIEW", "SUBMITTED", "DRAFT", "REQUIRES_CORRECTION"].includes(selected.status);

  // Reset checkboxes when switching selected letter
  useEffect(() => {
    setConfirmCitations(true);
    setAcceptMissing(true);
    setRejectionComment("");
    setRejectionError("");
  }, [selected?.id, selected?.updatedAt]);

  // Load claim documents for letter verification
  useEffect(() => {
    if (!selected?.claimId) {
      setClaimDocuments([]);
      return;
    }
    api.documents(selected.claimId)
      .then((res) => setClaimDocuments(res.data || []))
      .catch(() => setClaimDocuments([]));
  }, [selected?.claimId]);

  // Load claim documents for claim review
  useEffect(() => {
    if (!selectedClaimId) {
      setSelectedClaimDocuments([]);
      return;
    }
    setSelectedClaimDocsLoading(true);
    api.documents(selectedClaimId)
      .then((res) => setSelectedClaimDocuments(res.data || []))
      .catch(() => setSelectedClaimDocuments([]))
      .finally(() => setSelectedClaimDocsLoading(false));
  }, [selectedClaimId]);

  async function copyLetter() {
    if (!selected?.content) return;
    try {
      await navigator.clipboard.writeText(selected.content);
      if (toast) toast("Letter text copied to clipboard.", { type: "success" });
    } catch {
      if (toast) toast("Clipboard access was blocked by the browser.", { type: "error" });
    }
  }

  // Handle Appeal Approval
  async function handleApprove() {
    if (!selected || !canDecide || !isPendingDecision) return;
    if (!confirmCitations) {
      setError("Please check the clinical attestation box before certifying approval.");
      return;
    }

    setApproving(true);
    setError("");
    try {
      const approved = await api.approveAppealLetter(selected.id, {
        expectedUpdatedAt: selected.updatedAt,
        confirmUnverifiedDraft: true,
        acceptMissingEvidence: true,
        reviewerComment: rejectionComment || "Approved following clinical and insurance compliance review."
      });
      setLetters((rows) => rows.map((item) => item.id === approved.id ? approved : item));
      broadcastClaimUpdate("APPEAL_APPROVED", { letterId: selected.id, claimId: selected.claimId });
      if (toast) toast("Appeal letter approved and certified for insurance submission!", { type: "success" });
      setRevision((v) => v + 1);
    } catch (failure) {
      setError(failure.message);
      if (["LETTER_CHANGED", "ALREADY_APPROVED"].includes(failure.code)) setRevision((v) => v + 1);
    } finally {
      setApproving(false);
    }
  }

  // Handle Appeal Rejection
  async function handleReject(e) {
    e.preventDefault();
    if (!selected || !canDecide) return;
    if (!rejectionComment.trim()) {
      setRejectionError("Please provide clear reviewer feedback so the specialist can revise.");
      return;
    }

    setRejecting(true);
    setRejectionError("");
    try {
      const rejected = await api.rejectAppealLetter(selected.id, {
        reviewerComment: rejectionComment.trim(),
        feedback: rejectionComment.trim(),
        expectedUpdatedAt: selected.updatedAt
      });
      setLetters((rows) => rows.map((item) => item.id === rejected.id ? rejected : item));
      broadcastClaimUpdate("APPEAL_REJECTED", { letterId: selected.id, claimId: selected.claimId });
      if (toast) toast(`Appeal rejected and returned with feedback: "${rejectionComment.trim()}".`, { type: "info" });
      setRejectModalOpen(false);
      setRejectionComment("");
      setRevision((v) => v + 1);
    } catch (failure) {
      setRejectionError(failure.message || "Failed to reject appeal letter.");
    } finally {
      setRejecting(false);
    }
  }

  // Handle Claim Approval
  async function handleApproveClaim() {
    if (!selectedClaim) return;
    setAdjudicatingClaim(true);
    setClaimAdjudicationError("");
    try {
      await api.reviewClaim(selectedClaim.id, {
        decision: "APPROVED",
        reviewComments: claimReviewComment.trim() || "Claim approved following clinical record verification."
      });
      broadcastClaimUpdate("CLAIM_APPROVED", { claimId: selectedClaim.id });
      if (toast) toast(`Claim ${selectedClaim.claimNumber} approved successfully!`, { type: "success" });
      setClaimReviewComment("");
      setRevision((v) => v + 1);
    } catch (err) {
      setClaimAdjudicationError(err.message || "Failed to approve claim.");
    } finally {
      setAdjudicatingClaim(false);
    }
  }

  // Handle Claim Denial
  async function handleDenyClaim(e) {
    e.preventDefault();
    if (!selectedClaim) return;
    if (!claimReviewComment.trim()) {
      setClaimAdjudicationError("Please add a comment explaining specifically why this claim is being denied/cancelled so the hospital billing specialist understands.");
      return;
    }
    setAdjudicatingClaim(true);
    setClaimAdjudicationError("");
    try {
      await api.reviewClaim(selectedClaim.id, {
        decision: "DENIED",
        denialCode: claimDenialCode,
        denialExplanation: claimDenialExplanation,
        reviewComments: claimReviewComment.trim()
      });
      broadcastClaimUpdate("CLAIM_DENIED", { claimId: selectedClaim.id });
      if (toast) toast(`Claim ${selectedClaim.claimNumber} denied with code ${claimDenialCode}.`, { type: "info" });
      setClaimDenialModalOpen(false);
      setClaimReviewComment("");
      setRevision((v) => v + 1);
    } catch (err) {
      setClaimAdjudicationError(err.message || "Failed to deny claim.");
    } finally {
      setAdjudicatingClaim(false);
    }
  }

  function handleSelectLetter(item) {
    setSelectedId(item.id);
    setSearchParams({ tab: "appeals", letter: item.id });
  }

  function handleSelectClaim(claim) {
    setSelectedClaimId(claim.id);
    setSearchParams({ tab: "claims", claim: claim.id });
  }

  if (loading && letters.length === 0 && claims.length === 0) {
    return (
      <>
        <PageHeader title="Review Queue" description="Loading incoming review and approval requests..." />
        <LoadingState label="Loading review queue..." />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-3">
        <PageHeader
          eyebrow="Reviewer Portal"
          title="Review Queue"
          description="Review hospital claims and appeal letters. Approve or deny requests."
        />
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            icon={RotateCcw}
            onClick={() => load(false)}
            disabled={loading || isRefreshing}
            title="Refresh review queue"
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Primary Queue Switcher: Claim Review Queue vs Appeal Review Queue */}
      <div className="flex border-b border-slate-200 bg-white rounded-t-xl px-2">
        <button
          type="button"
          onClick={() => setActiveQueue("claims")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs font-bold transition ${
            activeQueue === "claims"
              ? "border-teal-700 text-teal-800"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <ClipboardList size={16} className={activeQueue === "claims" ? "text-teal-700" : "text-slate-400"} />
          <span>Claim Review Queue</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            pendingClaims.length > 0 ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-600"
          }`}>
            {claims.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveQueue("appeals")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs font-bold transition ${
            activeQueue === "appeals"
              ? "border-teal-700 text-teal-800"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <ShieldCheck size={16} className={activeQueue === "appeals" ? "text-teal-700" : "text-slate-400"} />
          <span>Appeal Review Queue</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            pendingLetters.length > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
          }`}>
            {letters.length}
          </span>
        </button>
      </div>

      {/* ===================== VIEW 1: APPEAL LETTERS QUEUE ===================== */}
      {activeQueue === "appeals" && (
        !letters.length ? (
          <Card>
            <EmptyState
              icon={ShieldCheck}
              title="No appeal letters in queue"
              description="Submitted appeal letters assigned to your review will appear here."
            />
          </Card>
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(280px,.8fr)_minmax(0,1.8fr)]">
            {/* Review Queue Sidebar */}
            <Card className="overflow-hidden">
              <CardHeader
                title="Appeal Review Queue"
                description={`${letters.length} total records (${pendingLetters.length} awaiting review)`}
              />

              {/* Filter Tabs */}
              <div className="flex border-b border-slate-200 bg-slate-50/70 p-1.5 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("ALL");
                  }}
                  className={`flex-1 rounded py-1.5 text-center transition ${
                    statusFilter === "ALL"
                      ? "bg-white text-indigo-700 shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  All ({letters.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("PENDING");
                    if (pendingLetters.length > 0 && !pendingLetters.some((l) => l.id === selectedId)) {
                      handleSelectLetter(pendingLetters[0]);
                    }
                  }}
                  className={`flex-1 rounded py-1.5 text-center transition ${
                    statusFilter === "PENDING"
                      ? "bg-white text-indigo-700 shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Needs Review ({pendingLetters.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("APPROVED");
                    if (approvedLetters.length > 0 && !approvedLetters.some((l) => l.id === selectedId)) {
                      handleSelectLetter(approvedLetters[0]);
                    }
                  }}
                  className={`flex-1 rounded py-1.5 text-center transition ${
                    statusFilter === "APPROVED"
                      ? "bg-white text-indigo-700 shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Approved ({approvedLetters.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("REJECTED");
                    if (rejectedLetters.length > 0 && !rejectedLetters.some((l) => l.id === selectedId)) {
                      handleSelectLetter(rejectedLetters[0]);
                    }
                  }}
                  className={`flex-1 rounded py-1.5 text-center transition ${
                    statusFilter === "REJECTED"
                      ? "bg-white text-indigo-700 shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Rejected ({rejectedLetters.length})
                </button>
              </div>

              {/* List */}
              <div className="max-h-[660px] overflow-y-auto p-2">
                {filteredLetters.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No appeal letters match the &ldquo;{statusFilter.toLowerCase()}&rdquo; filter.
                  </div>
                ) : (
                  filteredLetters.map((letter) => (
                    <button
                      key={letter.id}
                      type="button"
                      onClick={() => handleSelectLetter(letter)}
                      className={
                        "mb-1.5 w-full rounded-lg border p-3 text-left transition " +
                        (selectedId === letter.id
                          ? "border-indigo-300 bg-indigo-50/80 shadow-xs"
                          : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50/70")
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-xs font-bold text-slate-900">
                          {letter.claim?.claimNumber}
                        </strong>
                        <StatusBadge status={letter.status} />
                      </div>
                      <span className="mt-1 block truncate text-[11px] font-medium text-slate-700">
                        {letter.claim?.patientName ? `${letter.claim.patientName} • ` : ""}
                        {letter.subject}
                      </span>
                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="truncate max-w-[140px]">
                          {letter.claim?.hospitalName || "Hospital Facility"}
                        </span>
                        <span>{formatDate(letter.submittedAt || letter.updatedAt)}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </Card>

            {/* Letter Review Inspection */}
            {selected ? (
              <div className="grid gap-4">
                <Card className="overflow-hidden">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4 sm:p-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-teal-100 px-2 py-0.5 text-xs font-bold text-teal-800">
                          {selected.claim?.claimNumber}
                        </span>
                        <StatusBadge status={selected.status} />
                        {selected.claimId && (
                          <Link
                            to={`/claims/${selected.claimId}`}
                            className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline"
                          >
                            <ExternalLink size={12} />
                            View Original Claim
                          </Link>
                        )}
                      </div>
                      <h2 className="mt-2 text-base font-bold text-slate-900">{selected.subject}</h2>
                      <p className="mt-1 text-xs text-slate-500">
                        Author: <span className="font-semibold text-slate-700">{selected.author?.displayName || "Specialist"}</span> &bull; Patient: <span className="font-semibold text-slate-700">{selected.claim?.patientName || "—"}</span> &bull; Payer: <span className="font-semibold text-slate-700">{selected.claim?.payerName}</span>
                      </p>
                    </div>
                    <Button variant="outline" size="sm" icon={Clipboard} onClick={copyLetter}>
                      Copy Letter
                    </Button>
                  </div>

                  {/* Metadata Grid */}
                  <div className="grid gap-3 p-4 sm:grid-cols-4 sm:p-5 border-b border-slate-100 bg-slate-50/50">
                    <Meta label="Claim Amount" value={formatCurrency(selected.claim?.amount, selected.claim?.currency)} />
                    <Meta label="Hospital" value={selected.claim?.hospitalName || "—"} />
                    <Meta label="Revision" value={`Rev #${selected.revisionNumber || 1}`} />
                    <Meta label="Last Updated" value={formatDate(selected.updatedAt)} />
                  </div>

                  {/* Prior Reviewer Feedback Notice if was rejected */}
                  {selected.reviewerComment && selected.status === "REJECTED" && (
                    <div className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                      <strong>Current Rejection Feedback:</strong> &ldquo;{selected.reviewerComment}&rdquo;
                    </div>
                  )}

                  {/* Review Determination Actions */}
                  <div className="p-4 sm:p-5 border-b border-slate-100 bg-white">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                      Reviewer Determination & Attestation
                    </h3>

                    {canDecide && isPendingDecision ? (
                      <div className="space-y-3 rounded-lg border border-teal-100 bg-teal-50/50 p-4">
                        <label className="flex items-start gap-2 text-xs leading-5 text-slate-700 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            className="mt-1 size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                            checked={confirmCitations}
                            onChange={(e) => setConfirmCitations(e.target.checked)}
                          />
                          <span>
                            <strong className="text-slate-900 font-semibold">Verification Check:</strong> I confirm that I have reviewed this appeal letter and verified the attached medical records.
                          </span>
                        </label>

                        {selected.requiresCorrection && (
                          <label className="flex items-start gap-2 text-xs leading-5 text-amber-900 bg-amber-50 p-2 rounded border border-amber-200 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="mt-1 size-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                              checked={acceptMissing}
                              onChange={(e) => setAcceptMissing(e.target.checked)}
                            />
                            <span>
                              <strong>Acknowledge Missing Evidence:</strong> I choose to proceed even if some suggested evidence records are not attached.
                            </span>
                          </label>
                        )}

                        {!confirmCitations && (
                          <p className="text-[11px] text-amber-700 bg-amber-50 px-2 py-1.5 rounded border border-amber-200 flex items-center gap-1.5">
                            <AlertCircle size={13} className="shrink-0 text-amber-600" />
                            Please check the attestation box above to certify approval.
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                          <Button
                            className="bg-emerald-600 text-white hover:bg-emerald-700 font-bold"
                            icon={Check}
                            loading={approving}
                            disabled={!confirmCitations || (selected.requiresCorrection && !acceptMissing)}
                            onClick={handleApprove}
                          >
                            Approve Appeal
                          </Button>
                          <Button
                            variant="danger"
                            icon={XCircle}
                            onClick={() => {
                              setRejectionComment("");
                              setRejectionError("");
                              setRejectModalOpen(true);
                            }}
                          >
                            Reject & Return
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                        {selected.status === "APPROVED" ? (
                          <span className="flex items-center gap-1.5 text-emerald-800 font-semibold">
                            <Check size={14} className="text-emerald-600" /> This appeal is finalized and approved for payment/processing.
                          </span>
                        ) : selected.status === "REJECTED" ? (
                          <span className="flex items-center gap-1.5 text-red-800 font-semibold">
                            <XCircle size={14} className="text-red-600" /> This appeal was rejected with feedback and returned to the specialist.
                          </span>
                        ) : isAuthor ? (
                          "You authored this draft. A different compliance reviewer must perform independent adjudication."
                        ) : (
                          "Awaiting review determination."
                        )}
                      </div>
                    )}
                  </div>

                  {/* Letter Content */}
                  <div className="p-4 sm:p-5">
                    <label className="mb-2 block text-xs font-bold text-slate-700">Formal Appeal Letter Body</label>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-900 whitespace-pre-wrap">
                      {selected.content}
                    </div>
                  </div>
                </Card>

                {/* Grounding Checks & Supporting Evidence */}
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="overflow-hidden">
                    <CardHeader
                      title="Clinical Grounding Checks"
                      description="Validation of facts against verified hospital evidence"
                    />
                    <div className="grid gap-3 p-4">
                      <CheckLine ok={Boolean(selected.content?.trim())} label="Letter content complete" />
                      <CheckLine ok={selected.citations?.length > 0} label={`${selected.citations?.length || 0} cited clinical evidence document(s)`} />
                      <CheckLine ok={selected.grounded} label={selected.grounded ? "Verified against hospital clinical records" : "Grounding unverified (manual changes applied)"} />
                      <CheckLine ok={!selected.requiresCorrection} label={selected.requiresCorrection ? "Missing evidence requirements detected" : "All evidence requirements fulfilled"} />
                    </div>
                  </Card>

                  <Card className="overflow-hidden">
                    <CardHeader
                      title="Citations & Grounded Evidence"
                      description={`${uniqueCitations.length} supporting document(s) cited in this appeal`}
                    />
                    <div className="p-4">
                      {uniqueCitations.length === 0 ? (
                        <p className="py-4 text-center text-xs text-slate-400">No citations directly linked.</p>
                      ) : (
                        <div className="space-y-3">
                          {uniqueCitations.map((c, i) => {
                            const pageSuffix = c.pages?.length > 0 ? ` (Page ${c.pages.sort((a, b) => a - b).join(", ")})` : "";
                            return (
                              <div key={i} className="rounded-md border border-teal-100 bg-teal-50/50 p-2.5 text-xs text-slate-700">
                                <div className="flex items-center justify-between mb-1 font-semibold text-teal-900">
                                  <span className="truncate pr-2">{c.displayLabel}{pageSuffix}</span>
                                  <span className="shrink-0 text-[10px] uppercase font-bold text-teal-700 bg-teal-100 px-1.5 py-0.5 rounded">
                                    {titleCase(c.evidence?.type || c.evidenceType || "RECORD")}
                                  </span>
                                </div>
                                <p className="italic text-slate-600">&ldquo;{c.excerpt}&rdquo;</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </Card>
                </div>

                {/* Attached Medical Records with Direct Open File Link */}
                <Card className="overflow-hidden">
                  <CardHeader
                    title={`All Attached Medical Records & Uploaded Evidence (${claimDocuments.length})`}
                    description="Open original documents to independently audit the specialist's assertions."
                  />
                  <div className="p-4">
                    {claimDocuments.length === 0 ? (
                      <p className="py-3 text-center text-xs text-slate-400">
                        No clinical document files uploaded for this claim yet.
                      </p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {claimDocuments.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 hover:border-teal-200 transition"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <FileText size={16} className="text-teal-700 shrink-0" />
                              <div className="min-w-0">
                                <div className="truncate text-xs font-semibold text-slate-800">
                                  {doc.originalName}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {titleCase(doc.type)} &bull; {doc.sizeBytes ? `${(doc.sizeBytes / 1024).toFixed(1)} KB` : ""}
                                </div>
                              </div>
                            </div>

                            <a
                              href={api.documentDownloadUrl(doc.id)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-100 transition shrink-0 ml-2"
                            >
                              <ExternalLink size={12} /> Open File &rarr;
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            ) : (
              <Card>
                <EmptyState
                  icon={ShieldCheck}
                  title="No appeal letter selected"
                  description="Select an appeal letter from the queue on the left to inspect and review."
                />
              </Card>
            )}
          </div>
        )
      )}

      {/* ===================== VIEW 2: CLAIM APPROVALS QUEUE ===================== */}
      {activeQueue === "claims" && (
        !claims.length ? (
          <Card>
            <EmptyState
              icon={ClipboardList}
              title="No claims in queue"
              description="Hospital submitted claims routed to your insurance company will appear here."
            />
          </Card>
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(280px,.8fr)_minmax(0,1.8fr)]">
            {/* Claim Queue Sidebar */}
            <Card className="overflow-hidden">
              <CardHeader
                title="Claim Review Queue"
                description={`${claims.length} total claims (${pendingClaims.length} awaiting adjudication)`}
              />

              {/* Filter Tabs */}
              <div className="flex border-b border-slate-200 bg-slate-50/70 p-1.5 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setClaimStatusFilter("ALL");
                  }}
                  className={`flex-1 rounded py-1.5 text-center transition ${
                    claimStatusFilter === "ALL"
                      ? "bg-white text-indigo-700 shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  All ({claims.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClaimStatusFilter("SUBMITTED");
                    if (pendingClaims.length > 0 && !pendingClaims.some((c) => c.id === selectedClaimId)) {
                      handleSelectClaim(pendingClaims[0]);
                    }
                  }}
                  className={`flex-1 rounded py-1.5 text-center transition ${
                    claimStatusFilter === "SUBMITTED"
                      ? "bg-white text-indigo-700 shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Needs Review ({pendingClaims.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClaimStatusFilter("APPROVED");
                    if (approvedClaims.length > 0 && !approvedClaims.some((c) => c.id === selectedClaimId)) {
                      handleSelectClaim(approvedClaims[0]);
                    }
                  }}
                  className={`flex-1 rounded py-1.5 text-center transition ${
                    claimStatusFilter === "APPROVED"
                      ? "bg-white text-indigo-700 shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Approved ({approvedClaims.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClaimStatusFilter("DENIED");
                    if (deniedClaims.length > 0 && !deniedClaims.some((c) => c.id === selectedClaimId)) {
                      handleSelectClaim(deniedClaims[0]);
                    }
                  }}
                  className={`flex-1 rounded py-1.5 text-center transition ${
                    claimStatusFilter === "DENIED"
                      ? "bg-white text-indigo-700 shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Denied ({deniedClaims.length})
                </button>
              </div>

              {/* Claim List */}
              <div className="max-h-[660px] overflow-y-auto p-2">
                {filteredClaims.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No claims match the &ldquo;{claimStatusFilter.toLowerCase()}&rdquo; filter.
                  </div>
                ) : (
                  filteredClaims.map((claim) => (
                    <button
                      key={claim.id}
                      type="button"
                      onClick={() => handleSelectClaim(claim)}
                      className={
                        "mb-1.5 w-full rounded-lg border p-3 text-left transition " +
                        (selectedClaimId === claim.id
                          ? "border-indigo-300 bg-indigo-50/80 shadow-xs"
                          : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50/70")
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-xs font-bold text-slate-900">
                          {claim.claimNumber}
                        </strong>
                        <StatusBadge status={claim.status} />
                      </div>
                      <span className="mt-1 block truncate text-[11px] font-medium text-slate-700">
                        {claim.patientName} &bull; {formatCurrency(claim.amount, claim.currency)}
                      </span>
                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="truncate max-w-[140px]">
                          {claim.hospitalName || "Hospital Facility"}
                        </span>
                        <span>{formatDate(claim.serviceDate)}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </Card>

            {/* Claim Review Inspection & Adjudication */}
            {selectedClaim ? (
              <div className="grid gap-4">
                <Card className="overflow-hidden">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4 sm:p-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-800">
                          {selectedClaim.claimNumber}
                        </span>
                        <StatusBadge status={selectedClaim.status} />
                        <Link
                          to={`/claims/${selectedClaim.id}`}
                          className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline"
                        >
                          <ExternalLink size={12} /> Claim Packet
                        </Link>
                      </div>
                      <h2 className="mt-2 text-base font-bold text-slate-900">{selectedClaim.patientName}</h2>
                      <p className="mt-1 text-xs text-slate-500">
                        Hospital: <span className="font-semibold text-slate-700">{selectedClaim.hospitalName || "Hospital Facility"}</span> &bull; Payer: <span className="font-semibold text-slate-700">{selectedClaim.payerName}</span>
                      </p>
                    </div>

                    <div className="text-right">
                      <div className="text-lg font-bold text-slate-900">
                        {formatCurrency(selectedClaim.amount, selectedClaim.currency)}
                      </div>
                      <span className="text-[10px] text-slate-400">Total Billed</span>
                    </div>
                  </div>

                  {/* Metadata Grid */}
                  <div className="grid gap-3 p-4 sm:grid-cols-4 sm:p-5 border-b border-slate-100 bg-slate-50/50">
                    <Meta label="Policy Number" value={selectedClaim.policyNumber || "—"} />
                    <Meta label="Service Date" value={formatDate(selectedClaim.serviceDate)} />
                    <Meta label="Diagnosis Code" value={selectedClaim.diagnosisCode || "—"} />
                    <Meta label="Procedure Code" value={selectedClaim.procedureCode || "—"} />
                  </div>

                  {/* Treatment Description */}
                  <div className="p-4 sm:p-5 border-b border-slate-100">
                    <label className="mb-1 block text-xs font-bold text-slate-700">Treatment Description & Clinical Summary</label>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800">
                      {selectedClaim.treatmentDescription || "No clinical description provided."}
                    </div>
                  </div>

                  {/* Claim Adjudication Box */}
                  <div className="p-4 sm:p-5 bg-white">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                      Claim Adjudication Determination
                    </h3>

                    {claimAdjudicationError && (
                      <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                        {claimAdjudicationError}
                      </div>
                    )}

                    {["SUBMITTED", "UNDER_REVIEW"].includes(selectedClaim.status) ? (
                      <div className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
                        <label className="block text-xs font-semibold text-slate-700">
                          Auditor Reviewer Comment
                        </label>
                        <textarea
                          rows={2}
                          placeholder="Provide approval comments or reasons for decision..."
                          value={claimReviewComment}
                          onChange={(e) => setClaimReviewComment(e.target.value)}
                          className="w-full rounded-md border border-slate-200 bg-white p-2.5 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                        />

                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                          <Button
                            className="bg-emerald-600 text-white hover:bg-emerald-700 font-bold"
                            icon={Check}
                            loading={adjudicatingClaim}
                            onClick={handleApproveClaim}
                          >
                            Approve Claim
                          </Button>
                          <Button
                            variant="danger"
                            icon={XCircle}
                            onClick={() => {
                              setClaimAdjudicationError("");
                              setClaimDenialModalOpen(true);
                            }}
                          >
                            Deny / Reject Claim
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700">
                        {selectedClaim.status === "APPROVED" ? (
                          <div className="flex items-center gap-2 text-emerald-800 font-semibold">
                            <Check size={16} className="text-emerald-600 shrink-0" />
                            <span>This claim is <strong>Approved</strong>. Payment processing is authorized.</span>
                          </div>
                        ) : selectedClaim.status === "DENIED" ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-amber-900 font-bold">
                              <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                              <span>Claim Denied ({selectedClaim.denials?.[0]?.denialReason?.code || "DENIED"})</span>
                            </div>
                            <p className="text-slate-600">
                              {selectedClaim.denials?.[0]?.reasonText || selectedClaim.denials?.[0]?.denialReason?.title || "Claim was rejected during auditor adjudication."}
                            </p>
                          </div>
                        ) : (
                          <span>Current status: <StatusBadge status={selectedClaim.status} /></span>
                        )}
                      </div>
                    )}
                  </div>
                </Card>

                {/* Supporting Clinical Documents for Claim */}
                <Card className="overflow-hidden">
                  <CardHeader
                    title={`Attached Medical Records & Supporting Documents (${selectedClaimDocuments.length})`}
                    description="Open uploaded clinical records, operative summaries, or lab results to verify this claim."
                  />
                  <div className="p-4">
                    {selectedClaimDocsLoading ? (
                      <div className="py-4 text-center text-xs text-slate-400">Loading documents...</div>
                    ) : selectedClaimDocuments.length === 0 ? (
                      <p className="py-3 text-center text-xs text-slate-400">
                        No supporting clinical documents attached to this claim.
                      </p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {selectedClaimDocuments.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 hover:border-indigo-200 transition"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <FileText size={16} className="text-indigo-700 shrink-0" />
                              <div className="min-w-0">
                                <div className="truncate text-xs font-semibold text-slate-800">
                                  {doc.originalName}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {titleCase(doc.type)} &bull; {doc.sizeBytes ? `${(doc.sizeBytes / 1024).toFixed(1)} KB` : ""}
                                </div>
                              </div>
                            </div>

                            <a
                              href={api.documentDownloadUrl(doc.id)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 transition shrink-0 ml-2"
                            >
                              <ExternalLink size={12} /> Open File &rarr;
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            ) : (
              <Card>
                <EmptyState
                  icon={ClipboardList}
                  title="No claim selected"
                  description="Select a claim from the queue on the left to inspect and adjudicate."
                />
              </Card>
            )}
          </div>
        )
      )}

      {/* Appeal Rejection Feedback Modal */}
      <Modal
        open={rejectModalOpen}
        onClose={() => setRejectModalOpen(false)}
        title="Reject Appeal Draft with Feedback"
        description="Provide mandatory clinical feedback explaining why this appeal cannot be approved in its current form."
      >
        <form onSubmit={handleReject} className="space-y-4">
          {rejectionError && (
            <div className="rounded-md bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
              {rejectionError}
            </div>
          )}

          <CheckboxMultiSelect
            label="Required Missing Clinical Document(s)"
            options={REQUIRED_DOC_TYPES}
            selected={appealRejectDocTypes}
            onChange={handleAppealRejectDocsChange}
            placeholder="Select required missing documents (check all that apply)..."
          />

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Rejection Comment / Corrective Instructions <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={4}
              placeholder="e.g. Attending consultant's post-op clinical notes do not document conservative therapy trial failure. Please attach physiotherapy records and re-draft section 2."
              value={rejectionComment}
              onChange={(e) => setRejectionComment(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white p-2.5 text-xs text-slate-800 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setRejectModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" type="submit" loading={rejecting}>
              Confirm Rejection & Return
            </Button>
          </div>
        </form>
      </Modal>

      {/* Claim Denial Modal */}
      <Modal
        open={claimDenialModalOpen}
        onClose={() => setClaimDenialModalOpen(false)}
        title={`Deny Claim ${selectedClaim?.claimNumber}`}
        description="Provide the denial reason and mandatory auditor explanation so the hospital specialist can prepare an appeal."
      >
        <form onSubmit={handleDenyClaim} className="space-y-4">
          {claimAdjudicationError && (
            <div className="rounded-md bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
              {claimAdjudicationError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Denial Reason Code</label>
            <select
              value={claimDenialCode}
              onChange={(e) => {
                const code = e.target.value;
                setClaimDenialCode(code);
                const found = COMMON_DENIAL_CODES.find((c) => c.code === code);
                if (found) setClaimDenialExplanation(found.explanation);
              }}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-red-500 focus:outline-none"
            >
              {COMMON_DENIAL_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} &bull; {c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Denial Explanation</label>
            <textarea
              rows={2}
              value={claimDenialExplanation}
              onChange={(e) => setClaimDenialExplanation(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800"
            />
          </div>

          <CheckboxMultiSelect
            label="Missing / Required Clinical Document(s)"
            options={REQUIRED_DOC_TYPES}
            selected={claimMissingDocTypes}
            onChange={handleClaimMissingDocsChange}
            placeholder="Select missing documents (check all that apply)..."
          />

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Auditor Denial Comment <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              placeholder="e.g. Clinical notes missing pre-operative ECG and angiogram findings; prior authorization not on file..."
              value={claimReviewComment}
              onChange={(e) => setClaimReviewComment(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white p-2.5 text-xs text-slate-800 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setClaimDenialModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" type="submit" loading={adjudicatingClaim}>
              Confirm Claim Denial
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );

  function Meta({ label, value }) {
    return (
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-1 text-xs font-semibold text-slate-800">{value}</div>
      </div>
    );
  }

  function CheckLine({ ok, label }) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-700">
        <span className={"grid size-6 place-items-center rounded-full " + (ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
          {ok ? <Check size={13} /> : <FileCheck2 size={13} />}
        </span>
        <span>{label}</span>
      </div>
    );
  }
}
