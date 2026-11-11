import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  Check,
  Clipboard,
  FileCheck2,
  FileText,
  Save,
  Send,
  WandSparkles,
  AlertCircle,
  Clock,
  RotateCcw,
  Sparkles,
  ExternalLink,
  Search,
  ShieldCheck,
  CheckCircle2,
  Lock,
  ArrowRight,
  Upload
} from "lucide-react";
import { api } from "../api/client.js";
import { Button, Card, CardHeader, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pill, StateMessage, StatusBadge } from "../components/ui.jsx";
import { useAuth } from "../context/auth-context.jsx";
import { useToast } from "../context/toast-context.jsx";
import { formatCurrency, formatDate } from "../lib/format.js";
import { broadcastClaimUpdate, useClaimSync } from "../lib/sync.js";

export function AppealDraftPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast, notify } = useToast();
  const toast = showToast || notify;

  const [letters, setLetters] = useState([]);
  const [reviewers, setReviewers] = useState([]);
  const [denials, setDenials] = useState([]);
  const [selectedId, setSelectedId] = useState(searchParams.get("letter") || "");
  const [statusFilter, setStatusFilter] = useState("ALL"); // ALL | DRAFT | SUBMITTED | APPROVED | REJECTED
  const [searchQuery, setSearchQuery] = useState("");
  const [content, setContent] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [activeCitation, setActiveCitation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [revising, setRevising] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  // AI Rejection Analysis
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState("");
  const [generatingForClaim, setGeneratingForClaim] = useState(false);

  async function handleGenerateForClaim(targetClaimId) {
    const paramClaim = targetClaimId || searchParams.get("claim");
    if (!paramClaim) return;
    setGeneratingForClaim(true);
    try {
      const result = await api.generateAppeal(paramClaim, { limit: 8 });
      const letter = result.letter || result.data?.letter;
      if (letter) {
        if (toast) toast("Grounded appeal letter formulated! Review and edit your draft.", { type: "success" });
        setRevision((v) => v + 1);
        setSelectedId(letter.id);
        setSearchParams({ claim: paramClaim, letter: letter.id });
      }
    } catch (err) {
      if (toast) toast(err.message || "Failed to generate appeal letter.", { type: "error" });
    } finally {
      setGeneratingForClaim(false);
    }
  }

  const load = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError("");
    try {
      const [result, reviewerResult, denialsResult] = await Promise.all([
        api.appealLetters({ page: 1, limit: 50 }),
        api.reviewers(),
        api.denials({ page: 1, limit: 50 })
      ]);
      const rows = result.data || [];
      setLetters(rows);
      setReviewers(reviewerResult.data || []);
      setDenials((denialsResult?.data || []).filter((d) => d.status !== "RESOLVED" && d.status !== "CLOSED" && d.claim?.status !== "APPROVED"));

      const paramLetter = searchParams.get("letter");
      const paramClaim = searchParams.get("claim");

      if (paramLetter && rows.some((r) => r.id === paramLetter)) {
        setSelectedId(paramLetter);
      } else if (paramClaim && rows.some((r) => r.claimId === paramClaim || r.claim?.claimNumber === paramClaim || r.claim?.id === paramClaim)) {
        const match = rows.find((r) => r.claimId === paramClaim || r.claim?.claimNumber === paramClaim || r.claim?.id === paramClaim);
        setSelectedId(match.id);
      } else if (rows.length > 0 && (!selectedId || !rows.some((r) => r.id === selectedId))) {
        // Prioritize pending/draft letters over final approved ones
        const actionable = rows.find((r) => ["DRAFT", "REQUIRES_CORRECTION", "SUBMITTED_FOR_REVIEW", "REJECTED"].includes(r.status));
        setSelectedId(actionable ? actionable.id : rows[0].id);
      }
    } catch (failure) {
      if (!isSilent) setError(failure.message);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [revision, searchParams, selectedId]);

  useEffect(() => {
    load(false);
  }, [load]);

  // Silent polling every 3s and dynamic cross-tab synchronization
  useClaimSync(() => {
    if (!saving && !submitting && !revising && !aiLoading && !generatingForClaim) {
      load(true);
    }
  }, 3000);

  const selected = useMemo(() => {
    return letters.find((item) => item.id === selectedId) || letters[0] || null;
  }, [letters, selectedId]);

  // Keep selectedId synchronized with URL
  useEffect(() => {
    const targetLetter = searchParams.get("letter");
    const targetClaim = searchParams.get("claim");
    if (targetLetter && targetLetter !== selectedId && letters.some((l) => l.id === targetLetter)) {
      setSelectedId(targetLetter);
    } else if (targetClaim && (!selected || (selected.claimId !== targetClaim && selected.claim?.claimNumber !== targetClaim && selected.claim?.id !== targetClaim))) {
      const match = letters.find((l) => l.claimId === targetClaim || l.claim?.claimNumber === targetClaim || l.claim?.id === targetClaim);
      if (match && match.id !== selectedId) {
        setSelectedId(match.id);
      }
    }
  }, [searchParams, letters, selectedId, selected]);

  // Billing specialists and admins can edit drafts only when not locked in review or approved
  const isSpecialistOrAdmin = user?.role === "ADMIN" || user?.role === "BILLING_SPECIALIST" || user?.role === "PROVIDER";

  const isFinalApproved = selected?.status === "APPROVED" || selected?.claim?.status === "APPROVED";
  const isRejected = !isFinalApproved && selected?.status === "REJECTED";

  // Can only edit if in DRAFT or REQUIRES_CORRECTION, and NOT approved!
  const canEdit = Boolean(
    selected &&
    !isFinalApproved &&
    isSpecialistOrAdmin &&
    ["DRAFT", "REQUIRES_CORRECTION"].includes(selected.status)
  );

  const isLockedInReview = Boolean(
    selected &&
    !isFinalApproved &&
    ["SUBMITTED_FOR_REVIEW", "IN_REVIEW", "SUBMITTED"].includes(selected.status)
  );

  useEffect(() => {
    setContent(selected?.content || "");
    setReviewerId(selected?.reviewer?.id || selected?.reviewerId || reviewers[0]?.id || "");
    setActiveCitation(null);
  }, [selected?.id, selected?.updatedAt, reviewers]);

  const isDirty = useMemo(() => Boolean(selected && canEdit && (
    content !== selected.content || reviewerId !== (selected.reviewer?.id || selected.reviewerId || "")
  )), [canEdit, content, reviewerId, selected]);

  // Filter letters for the sidebar list
  const filteredLetters = useMemo(() => {
    return letters.filter((letter) => {
      if (statusFilter === "DRAFT" && !["DRAFT", "REQUIRES_CORRECTION"].includes(letter.status)) return false;
      if (statusFilter === "SUBMITTED" && !["SUBMITTED_FOR_REVIEW", "IN_REVIEW", "SUBMITTED"].includes(letter.status)) return false;
      if (statusFilter === "APPROVED" && letter.status !== "APPROVED") return false;
      if (statusFilter === "REJECTED" && letter.status !== "REJECTED") return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const claimNum = (letter.claim?.claimNumber || "").toLowerCase();
        const patName = (letter.claim?.patientName || "").toLowerCase();
        const subj = (letter.subject || "").toLowerCase();
        if (!claimNum.includes(q) && !patName.includes(q) && !subj.includes(q)) return false;
      }
      return true;
    });
  }, [letters, statusFilter, searchQuery]);

  async function saveDraft() {
    if (!selected || !canEdit || !isDirty) return;
    setSaving(true);
    try {
      const saved = await api.updateAppealLetter(selected.id, {
        content,
        reviewerId: reviewerId || null,
        expectedUpdatedAt: selected.updatedAt
      });
      setLetters((rows) => rows.map((item) => item.id === saved.id ? saved : item));
      setContent(saved.content);
      setReviewerId(saved.reviewer?.id || "");
      if (toast) toast(saved.grounded ? "Appeal draft saved successfully." : "Draft saved.", { type: "success" });
    } catch (failure) {
      if (toast) toast(failure.message, { type: "error" });
      if (failure.code === "LETTER_CHANGED") setRevision((v) => v + 1);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitForReview() {
    if (!selected) return;
    if (!reviewerId && reviewers.length > 0) {
      if (toast) toast("Please assign a medical reviewer before submitting.", { type: "error" });
      return;
    }
    setSubmitting(true);
    try {
      if (isDirty) {
        await api.updateAppealLetter(selected.id, {
          content,
          reviewerId: reviewerId || null,
          expectedUpdatedAt: selected.updatedAt
        });
      }
      const submitted = await api.submitAppealLetter(selected.id, {
        reviewerId: reviewerId || undefined
      });
      setLetters((rows) => rows.map((item) => item.id === submitted.id ? submitted : item));
      broadcastClaimUpdate("APPEAL_SUBMITTED", { letterId: submitted.id, claimId: submitted.claimId });
      if (toast) toast("Appeal letter submitted to insurance reviewer! Status updated to Under Review.", { type: "success" });
      setRevision((v) => v + 1);
    } catch (failure) {
      if (toast) toast(failure.message || "Failed to submit for review.", { type: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  async function copyDraft() {
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content);
      if (toast) toast("Draft copied to clipboard.", { type: "success" });
    } catch {
      if (toast) toast("Clipboard access was blocked by the browser.", { type: "error" });
    }
  }

  async function handleAnalyzeRejection() {
    if (!selected) return;
    setAiModalOpen(true);
    setAiLoading(true);
    setAiError("");
    setAiResult(null);
    try {
      const res = await api.analyzeRejection(selected.claimId, { letterId: selected.id });
      setAiResult(res);
    } catch (err) {
      setAiError(err.message || "Failed to analyze rejection feedback.");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleRevise() {
    if (!selected) return;
    setRevising(true);
    try {
      const revised = await api.reviseAppealLetter(selected.id, { content });
      setLetters((rows) => rows.map((item) => item.id === revised.id ? revised : item));
      setContent(revised.content);
      broadcastClaimUpdate("APPEAL_REVISED", { letterId: revised.id, claimId: revised.claimId });
      if (toast) toast(`Appeal draft reopened for editing (Rev #${revised.revisionNumber || 2}). You can now revise and resubmit.`, { type: "success" });
      setRevision((v) => v + 1);
    } catch (err) {
      if (toast) toast(err.message || "Failed to revise appeal.", { type: "error" });
    } finally {
      setRevising(false);
    }
  }

  function handleSelectLetter(letter) {
    setSelectedId(letter.id);
    setSearchParams({ letter: letter.id, claim: letter.claimId });
  }

  if (loading && letters.length === 0) {
    return (
      <>
        <PageHeader title="Appeal Letters & Drafts" description="Review saved appeal letters and cited medical records." />
        <LoadingState label="Loading appeal letters..." />
      </>
    );
  }

  if (error && letters.length === 0) {
    return (
      <>
        <PageHeader title="Appeal Letters & Drafts" description="Review saved appeal letters and cited medical records." />
        <ErrorState message={error} onRetry={() => setRevision((v) => v + 1)} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Hospital Appeals"
        title="Appeal Letters & Drafts"
        description="Select any claim to view its appeal letter, check cited medical records, and submit for insurance review."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/denials"
              className="inline-flex min-h-9 items-center gap-2 rounded-md bg-teal-700 px-3 text-xs font-semibold text-white hover:bg-teal-800"
            >
              <WandSparkles size={15} />
              Denial Analysis &rarr;
            </Link>
          </div>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {error}
        </div>
      )}

      {/* If an actively denied claim was passed via URL but has no draft yet */}
      {searchParams.get("claim") && denials.some((d) => (d.claimId === searchParams.get("claim") || d.claim?.claimNumber === searchParams.get("claim")) && d.claim?.status === "DENIED") && !letters.some((r) => r.claimId === searchParams.get("claim") || r.claim?.claimNumber === searchParams.get("claim") || r.claim?.id === searchParams.get("claim")) && (
        <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/80 p-4 shadow-2xs">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div>
              <strong className="text-xs font-bold text-indigo-950 block">
                No Appeal Draft Exists for Denied Claim {searchParams.get("claim")}
              </strong>
              <p className="text-xs text-slate-600">
                Uploaded rebuttal evidence is ready for this claim. Click below to formulate a grounded appeal letter using AI.
              </p>
            </div>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold shrink-0"
              icon={WandSparkles}
              loading={generatingForClaim}
              onClick={handleGenerateForClaim}
            >
              Generate Appeal Letter with AI &rarr;
            </Button>
          </div>
        </div>
      )}

      {!letters.length ? (
        <Card>
          <EmptyState
            icon={FileCheck2}
            title="No appeal letters found"
            description="Select a denied claim in Denial Analysis to run AI generation and draft an appeal letter."
            action={
              <Link to="/denials" className="text-xs font-semibold text-teal-800 hover:underline">
                Go to Denial Analysis &rarr;
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[330px_1fr]">
          {/* Left Column: List of Appeal Letters */}
          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 p-3 bg-slate-50/70">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-bold text-slate-800">
                  Appeals ({letters.length})
                </span>
                <span className="text-[11px] text-slate-500">
                  {filteredLetters.length} shown
                </span>
              </div>

              {/* Search */}
              <div className="relative mb-2">
                <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search patient, claim #..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs text-slate-800 placeholder-slate-400 focus:border-teal-500 focus:outline-none"
                />
              </div>

              {/* Status Filter Pills */}
              <div className="flex flex-wrap gap-1 text-[11px]">
                {[
                  { key: "ALL", label: `All (${letters.length})` },
                  { key: "DRAFT", label: `Drafts (${letters.filter(l => ["DRAFT", "REQUIRES_CORRECTION"].includes(l.status)).length})` },
                  { key: "SUBMITTED", label: `In Review (${letters.filter(l => ["SUBMITTED_FOR_REVIEW", "IN_REVIEW", "SUBMITTED"].includes(l.status)).length})` },
                  { key: "APPROVED", label: `Approved (${letters.filter(l => l.status === "APPROVED").length})` },
                  { key: "REJECTED", label: `Rejected (${letters.filter(l => l.status === "REJECTED").length})` }
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setStatusFilter(tab.key)}
                    className={
                      "rounded px-2 py-1 font-semibold transition " +
                      (statusFilter === tab.key
                        ? "bg-teal-700 text-white shadow-2xs"
                        : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/70")
                    }
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* List */}
            <div className="max-h-[700px] overflow-y-auto p-2 space-y-1.5">
              {filteredLetters.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No appeals match the selected filter.
                </div>
              ) : (
                filteredLetters.map((letter) => {
                  const isSelected = selectedId === letter.id;
                  return (
                    <button
                      key={letter.id}
                      type="button"
                      onClick={() => handleSelectLetter(letter)}
                      className={
                        "w-full rounded-lg border p-3 text-left transition " +
                        (isSelected
                          ? "border-teal-400 bg-teal-50/70 shadow-2xs"
                          : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50/80")
                      }
                    >
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <strong className="text-xs font-bold text-slate-900">
                          {letter.claim?.claimNumber}
                        </strong>
                        <StatusBadge status={(letter.claim?.status === "APPROVED" || letter.status === "APPROVED") ? "APPROVED" : letter.status} />
                      </div>
                      <div className="text-xs font-medium text-slate-800 truncate">
                        {letter.claim?.patientName || "Patient"}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{formatCurrency(letter.claim?.amount, letter.claim?.currency)}</span>
                        <span>Rev #{letter.revisionNumber || 1}</span>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400 truncate">
                        {formatDate(letter.updatedAt || letter.createdAt)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </Card>

          {/* Right Column: Selected Appeal Workspace */}
          {selected ? (
            <div className="space-y-4">
              {/* Dynamic State Alert Banners */}
              {isLockedInReview && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-xs text-sky-900 shadow-2xs">
                  <div className="flex items-start gap-3">
                    <Clock size={18} className="text-sky-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-sky-950 text-sm">
                          Appeal Under Review — Editing Locked
                        </h3>
                        <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                          Awaiting Reviewer
                        </span>
                      </div>
                      <p className="mt-1 text-sky-800 leading-relaxed">
                        This appeal was submitted to the insurance company on <strong>{formatDate(selected.submittedAt || selected.updatedAt)}</strong>.
                        Editing and resubmission are blocked while the compliance reviewer evaluates your documentation.
                      </p>
                      <div className="mt-2 text-[11px] text-sky-700">
                        Assigned Reviewer: <span className="font-semibold">{selected.reviewer?.displayName || "Insurance Review Desk"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {isFinalApproved && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900 shadow-2xs">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-emerald-950 text-sm">
                          Appeal Approved — Claim Finalized & Closed
                        </h3>
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-300">
                            Approved
                          </span>
                          <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                            Closed
                          </span>
                        </div>
                      </div>
                      <p className="mt-1 text-emerald-800 leading-relaxed">
                        The insurance reviewer approved this appeal on <strong>{formatDate(selected.reviewedAt || selected.updatedAt)}</strong>.
                        The claim has been overturned from Denied to Approved. No further appeal actions are required. The case is now closed.
                      </p>
                      {selected.reviewerComment && (
                        <div className="mt-2 rounded bg-white p-2 border border-emerald-200 text-slate-800 font-medium">
                          Reviewer Comments: &ldquo;{selected.reviewerComment}&rdquo;
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {isRejected && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900 shadow-2xs">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-red-950 text-sm">
                          Appeal Rejected / Incomplete by Reviewer (Rev #{selected.revisionNumber || 1})
                        </h3>
                        <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800">
                          Re-Appeal Required
                        </span>
                      </div>
                      <p className="mt-1 text-red-800 leading-relaxed">
                        Reviewer Feedback: &ldquo;<strong>{selected.reviewerComment || "Additional clinical evidence required."}</strong>&rdquo;
                      </p>
                      <div className="mt-3 rounded-md bg-white p-3 border border-red-100 shadow-xs">
                        <p className="font-semibold text-slate-800 mb-2">Guided Re-Appeal Workflow:</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={Sparkles}
                            onClick={() => navigate(`/denials?claim=${selected.claimId}&selected=${selected.claim?.denials?.[0]?.id || ""}`)}
                          >
                            1. AI Denial Analysis →
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={Upload}
                            onClick={() => navigate(`/evidence?claim=${selected.claimId}`)}
                          >
                            2. Upload New Evidence →
                          </Button>
                          <Button
                            size="sm"
                            className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
                            icon={WandSparkles}
                            loading={generatingForClaim}
                            onClick={() => handleGenerateForClaim(selected.claimId)}
                          >
                            3. Generate New Appeal with AI (Rev #{(selected.revisionNumber || 1) + 1})
                          </Button>
                          <button
                            type="button"
                            onClick={handleRevise}
                            className="text-[11px] text-slate-500 underline hover:text-slate-800 ml-auto cursor-pointer"
                          >
                            Or edit current text directly
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {canEdit && (
                <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3.5 text-xs text-teal-900 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <WandSparkles size={16} className="text-teal-700 shrink-0" />
                    <div className="flex-1">
                      <strong className="font-bold text-teal-950">Draft Appeal Ready for Review</strong>
                      <span className="ml-1 text-teal-800">
                        — You can edit the text, verify the citations, and click Submit Appeal to send this request to the insurance reviewer.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Editor Card */}
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-teal-100 px-2 py-0.5 text-xs font-bold text-teal-800">
                        {selected.claim?.claimNumber}
                      </span>
                      <StatusBadge status={selected.status} />
                      <span className="text-xs text-slate-500 font-semibold">
                        Rev #{selected.revisionNumber || 1}
                      </span>
                    </div>
                    <h2 className="mt-2 text-sm font-bold text-slate-900">{selected.subject}</h2>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Patient: <span className="font-semibold text-slate-700">{selected.claim?.patientName || "—"}</span> &bull; Hospital: <span className="font-semibold text-slate-700">{selected.claim?.hospitalName || "—"}</span> &bull; Payer: <span className="font-semibold text-slate-700">{selected.claim?.payerName || "—"}</span>
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" icon={Clipboard} onClick={copyDraft}>
                      Copy Text
                    </Button>
                    {canEdit ? (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={Save}
                          loading={saving}
                          disabled={!isDirty}
                          onClick={saveDraft}
                        >
                          Save Draft
                        </Button>
                        <Button
                          size="sm"
                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3.5 shadow-2xs"
                          icon={Send}
                          loading={submitting}
                          onClick={handleSubmitForReview}
                        >
                          Submit Appeal
                        </Button>
                      </>
                    ) : isLockedInReview ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-800">
                        <Lock size={13} className="text-sky-600" /> Locked in Review
                      </span>
                    ) : isFinalApproved ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">
                        <Check size={13} className="text-emerald-600" /> Approved
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="appeal-content" className="block text-xs font-bold text-slate-700">
                      Appeal Letter Body
                    </label>
                    {!canEdit && (
                      <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                        <Lock size={11} /> Read Only
                      </span>
                    )}
                  </div>
                  <textarea
                    id="appeal-content"
                    readOnly={!canEdit}
                    className={
                      "min-h-[420px] w-full resize-y rounded-md border p-4 font-mono text-xs leading-relaxed outline-none transition " +
                      (canEdit
                        ? "border-slate-200 bg-white text-slate-800 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                        : "border-slate-200 bg-slate-50 text-slate-700 cursor-not-allowed")
                    }
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />

                  <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <div>
                      <label htmlFor="appeal-reviewer" className="mb-1 block text-xs font-semibold text-slate-700">
                        Assigned Medical Reviewer
                      </label>
                      <select
                        id="appeal-reviewer"
                        disabled={!canEdit}
                        className="min-h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 disabled:bg-slate-50 focus:border-teal-500 focus:outline-none"
                        value={reviewerId}
                        onChange={(e) => setReviewerId(e.target.value)}
                      >
                        <option value="">Select a Reviewer...</option>
                        {reviewers.map((rev) => (
                          <option key={rev.id} value={rev.id}>
                            {rev.displayName} &bull; ({rev.email})
                          </option>
                        ))}
                      </select>
                    </div>

                    {(user?.role === "ADMIN" || user?.role === "REVIEWER" || user?.role === "COMPLIANCE_REVIEWER") && (
                      <Link
                        to={`/appeals/review?letter=${encodeURIComponent(selected.id)}`}
                        className="pb-2 text-xs font-semibold text-teal-800 hover:underline flex items-center gap-1"
                      >
                        Inspect in Review Desk <ArrowRight size={13} />
                      </Link>
                    )}
                  </div>

                  {/* Bottom Action Bar */}
                  {canEdit && (
                    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-4">
                      <div className="flex items-center gap-2 text-xs">
                        {isDirty ? (
                          <span className="flex items-center gap-1.5 font-medium text-amber-700">
                            <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                            Unsaved edits in appeal draft
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 font-medium text-emerald-700">
                            <span className="size-2 rounded-full bg-emerald-500" />
                            Draft saved & ready for submission
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          icon={Save}
                          loading={saving}
                          disabled={!isDirty}
                          onClick={saveDraft}
                        >
                          Save Draft
                        </Button>
                        <Button
                          size="sm"
                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 shadow-xs"
                          icon={Send}
                          loading={submitting}
                          onClick={handleSubmitForReview}
                        >
                          Submit Appeal &rarr;
                        </Button>
                      </div>
                    </div>
                  )}

                  {selected.status === "APPROVED" && (
                    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-emerald-200 bg-emerald-50/70 p-3.5 rounded-lg shadow-2xs">
                      <div className="flex items-center gap-2 text-xs font-semibold text-emerald-950">
                        <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                        <span>Appeal Approved & Certified by Reviewer — Claim Overturned & Case Closed</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-0.5 border border-emerald-300">
                          Approved
                        </span>
                        <span className="rounded bg-slate-200 text-slate-700 text-[11px] font-bold px-2 py-0.5">
                          Closed
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* Validation Checks & Citations */}
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="overflow-hidden">
                  <CardHeader
                    title="Clinical Grounding Checks"
                    description="AI verification against claim-owned documents"
                  />
                  <div className="grid gap-3 p-4">
                    <CheckLine
                      ok={Boolean(content.trim())}
                      label="Letter content present"
                      detail={`${content.trim().length} chars`}
                    />
                    <CheckLine
                      ok={selected.citations?.length > 0}
                      label="Evidence citations attached"
                      detail={`${selected.citations?.length || 0} citation(s)`}
                    />
                    <CheckLine
                      ok={Boolean(selected.grounded)}
                      label="AI factual arguments grounded in files"
                      detail={selected.grounded ? "Verified" : "Pending human review"}
                    />
                    <StateMessage tone={selected.requiresCorrection ? "amber" : selected.grounded ? "green" : "blue"}>
                      {selected.requiresCorrection
                        ? "Checklist flagged missing evidence records. Reviewer must evaluate gap."
                        : selected.grounded
                          ? "Grounded against verified clinical records and evidence files."
                          : "Human reviewer verification required for ungrounded statements."}
                    </StateMessage>
                  </div>
                </Card>

                <Card className="overflow-hidden">
                  <CardHeader
                    title="Grounded Document Citations"
                    description="Click any citation below to inspect extracted excerpt"
                  />
                  {!selected.citations?.length ? (
                    <EmptyState
                      icon={FileText}
                      title="No citations attached"
                      description="Generate an appeal from Denial Analysis with uploaded evidence to attach citations."
                    />
                  ) : (
                    <div className="divide-y divide-slate-100 px-4">
                      {selected.citations.map((citation, index) => (
                        <button
                          type="button"
                          key={citation.evidenceId || index}
                          onClick={() => setActiveCitation(citation)}
                          className={
                            "flex w-full gap-2.5 py-3 text-left transition " +
                            (activeCitation?.evidenceId === citation.evidenceId
                              ? "text-teal-800 font-semibold"
                              : "text-slate-600 hover:text-slate-900")
                          }
                        >
                          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-teal-50 text-[10px] font-bold text-teal-800">
                            {index + 1}
                          </span>
                          <span className="min-w-0">
                            <strong className="block truncate text-xs">
                              {citation.evidence?.sourceLabel || "Document Evidence"}
                            </strong>
                            <span className="mt-0.5 block text-[10px] text-slate-500">
                              {citation.evidence?.type?.toLowerCase()?.replaceAll("_", " ")} &bull; {formatDate(citation.evidence?.sourceDate)}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-slate-400">
                              Source file: {citation.evidence?.document?.originalName || "Uploaded document"}
                            </span>
                          </span>
                        </button>
                      ))}

                      {activeCitation && (
                        <div className="my-3 rounded-md bg-slate-50 p-3 text-xs border border-slate-200">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                              Verified Source Excerpt:
                            </span>
                            {activeCitation.evidence?.documentId && (
                              <a
                                href={api.documentDownloadUrl(activeCitation.evidence.documentId)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-semibold text-teal-800 hover:underline text-[11px]"
                              >
                                <ExternalLink size={11} /> Open File
                              </a>
                            )}
                          </div>
                          <p className="mt-1 text-slate-700 italic">
                            &ldquo;{activeCitation.excerpt || activeCitation.evidence?.summary}&rdquo;
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          ) : (
            <Card>
              <EmptyState
                icon={FileCheck2}
                title="No appeal letter selected"
                description="Select a claim from the list on the left to inspect or edit its appeal."
              />
            </Card>
          )}
        </div>
      )}

      {/* AI Rejection Analysis Modal */}
      {aiModalOpen && (
        <Modal
          open={true}
          title="AI Rejection Feedback Analysis"
          onClose={() => setAiModalOpen(false)}
        >
          <div className="space-y-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
              <span className="font-bold text-slate-800">Claim {selected?.claim?.claimNumber}:</span>{" "}
              <span className="text-slate-600">{selected?.claim?.patientName} &bull; Payer: {selected?.claim?.payerName}</span>
              {selected?.reviewerComment && (
                <div className="mt-2 text-red-700 bg-red-50 p-2 rounded border border-red-200">
                  <strong>Reviewer Feedback:</strong> &ldquo;{selected.reviewerComment}&rdquo;
                </div>
              )}
            </div>

            {aiLoading && (
              <div className="py-8 text-center">
                <div className="mx-auto size-7 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
                <p className="mt-2 text-xs text-slate-500">Evaluating reviewer rejection against case evidence...</p>
              </div>
            )}

            {aiError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {aiError}
              </div>
            )}

            {aiResult && (
              <div className="space-y-3">
                <div className="rounded-md border border-teal-200 bg-teal-50/60 p-3">
                  <h4 className="text-xs font-bold text-teal-900 mb-1">AI Clinical Critique & Summary</h4>
                  <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">{aiResult.analysis?.summary || aiResult.analysis}</p>
                </div>

                {aiResult.analysis?.requiredActions?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 mb-1.5">Actionable Evidence Gaps</h4>
                    <ul className="list-disc pl-4 space-y-1 text-xs text-slate-600">
                      {aiResult.analysis.requiredActions.map((rec, i) => (
                        <li key={i}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="outline" onClick={() => setAiModalOpen(false)}>
                Close
              </Button>
              <Button
                icon={RotateCcw}
                onClick={() => {
                  setAiModalOpen(false);
                  handleRevise();
                }}
              >
                Reopen & Revise Draft
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function CheckLine({ ok, label, detail }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={"grid size-6 place-items-center rounded-full " + (ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
        {ok ? <Check size={13} /> : <FileText size={12} />}
      </span>
      <span className="flex-1 text-xs font-medium text-slate-700">{label}</span>
      <span className="text-[10px] font-semibold text-slate-500">{detail}</span>
    </div>
  );
}
