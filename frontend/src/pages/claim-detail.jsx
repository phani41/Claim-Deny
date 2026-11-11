import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { 
  ArrowLeft, 
  FilePlus2, 
  FileWarning, 
  Files, 
  Building2, 
  User, 
  ShieldCheck, 
  Sparkles,
  CheckCircle2,
  XCircle,
  FileText,
  ExternalLink
} from "lucide-react";
import { api } from "../api/client.js";
import { Button, Card, CardHeader, CheckboxMultiSelect, EmptyState, ErrorState, LoadingState, Modal, PageHeader, StatusBadge } from "../components/ui.jsx";
import { useAuth } from "../context/auth-context.jsx";
import { useToast } from "../context/toast-context.jsx";
import { formatCurrency, formatDate } from "../lib/format.js";
import { broadcastClaimUpdate, useClaimSync } from "../lib/sync.js";

const COMMON_DENIAL_CODES = [
  { code: "AUTH-01", title: "Lack of Prior Authorization", explanation: "Service requires prior authorization prior to admission or treatment, but no authorization was requested or on file." },
  { code: "MED-01", title: "Medical Necessity Not Established", explanation: "Submitted clinical documentation does not establish medical necessity for the level of acute care or elective procedure billed." },
  { code: "DOC-01", title: "Insufficient Clinical Documentation", explanation: "Key diagnostic test results, physician order sheets, or operative summaries are missing from the claim package." },
  { code: "POLICY-01", title: "Policy Exclusion or Benefit Limit Exceeded", explanation: "The specified diagnosis or therapeutic procedure is not covered under the active policy terms or exceeds sub-limit." },
  { code: "TIMELY-01", title: "Exceeded Timely Filing Limit", explanation: "Claim was submitted beyond the mandated 30-day window following patient discharge without pre-approved extension." }
];

const REQUIRED_DOC_TYPES = [
  { value: "CLINICAL_NOTE", label: "Clinical / Operative Note" },
  { value: "IMAGING_REPORT", label: "Imaging / Radiology Report" },
  { value: "LAB_RESULT", label: "Laboratory / Diagnostic Result" },
  { value: "ORDER", label: "Physician Order / Prescription" },
  { value: "AUTHORIZATION", label: "Prior Authorization Request" },
  { value: "REFERRAL", label: "Medical Referral Document" },
  { value: "TREATMENT_HISTORY", label: "Treatment / Discharge Summary" },
  { value: "OTHER", label: "Other Supporting Evidence" }
];

export function ClaimDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { showToast, notify } = useToast();
  const toast = showToast || notify;

  const [claim, setClaim] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  // Reviewer adjudication modal
  const [adjudicateModalOpen, setAdjudicateModalOpen] = useState(false);
  const [decisionMode, setDecisionMode] = useState("NONE");
  const [denialCode, setDenialCode] = useState("AUTH-01");
  const [denialExplanation, setDenialExplanation] = useState(COMMON_DENIAL_CODES[0].explanation);
  const [missingDocTypes, setMissingDocTypes] = useState([]);
  const [reviewComments, setReviewComments] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState("");

  function handleMissingDocsChange(newTypes) {
    setMissingDocTypes(newTypes);
    const labels = newTypes.map((v) => REQUIRED_DOC_TYPES.find((d) => d.value === v)?.label).filter(Boolean);
    const prefix = labels.length > 0 ? `Missing required ${labels.join(", ")}. ` : "";
    setReviewComments((prev) => {
      const stripped = prev.replace(/^Missing required [^.]+\.\s*/, "").trim();
      return prefix + stripped;
    });
  }

  const isReviewerRole = ["COMPLIANCE_REVIEWER", "REVIEWER", "ADMIN"].includes(user?.role);
  const isSpecialistRole = ["BILLING_SPECIALIST", "PROVIDER"].includes(user?.role);

  const load = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError("");
    try {
      setClaim(await api.claim(id));
    } catch (failure) {
      if (!isSilent) setError(failure.message);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [id, revision]);

  useEffect(() => { load(false); }, [load]);

  // Synchronize dynamically across tabs and poll every 3 seconds
  useClaimSync(() => {
    if (!adjudicateModalOpen && !submittingReview) {
      load(true);
    }
  }, 3000);

  async function handleAdjudicate(decision) {
    setReviewError("");
    if (decision === "DENIED") {
      if (!denialCode.trim()) { setReviewError("Denial code is required."); return; }
      if (!denialExplanation.trim()) { setReviewError("Denial explanation is required."); return; }
      if (!reviewComments.trim()) {
        setReviewError("Please add a comment explaining specifically why this claim is being denied/cancelled so the hospital understands.");
        return;
      }
    }
    setSubmittingReview(true);
    try {
      await api.reviewClaim(claim.id, {
        decision,
        denialCode: decision === "DENIED" ? denialCode : undefined,
        denialExplanation: decision === "DENIED" ? denialExplanation : undefined,
        reviewComments: reviewComments.trim() || undefined
      });
      broadcastClaimUpdate("CLAIM_ADJUDICATED", { claimId: claim.id, decision });
      if (toast) toast(`Claim ${claim.claimNumber} was successfully ${decision.toLowerCase()}.`, { type: "success" });
      setAdjudicateModalOpen(false);
      setRevision((v) => v + 1);
    } catch (err) {
      setReviewError(err.message || "Failed to submit adjudication.");
    } finally {
      setSubmittingReview(false);
    }
  }

  if (loading && !claim) return <><PageHeader title="Claim details" /><LoadingState label="Loading claim details" /></>;
  if (error && !claim) return <><PageHeader title="Claim details" /><ErrorState message={error} onRetry={() => setRevision((v) => v + 1)} /></>;

  const primaryDenial = claim.denials?.[0];

  return (
    <>
      <PageHeader
        eyebrow="Hospital-to-Payer Claim"
        title={claim.claimNumber}
        description={`${claim.patientName || "Patient"} • Hospital: ${claim.hospitalOrganization?.name || claim.hospitalName} • Payer: ${claim.insuranceOrganization?.name || claim.payerName}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50" to="/claims">
              <ArrowLeft size={15} /> All Claims
            </Link>

            {/* Reviewer Action: Adjudicate claim if submitted */}
            {isReviewerRole && (claim.status === "SUBMITTED" || claim.status === "UNDER_REVIEW") && (
              <Button
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                icon={ShieldCheck}
                onClick={() => {
                  setDecisionMode("NONE");
                  setReviewComments("");
                  setReviewError("");
                  setAdjudicateModalOpen(true);
                }}
              >
                Review Claim
              </Button>
            )}

            {/* Specialist Action: AI denial analysis if denied */}
            {isSpecialistRole && claim.status === "DENIED" && primaryDenial && (
              <Link
                className="inline-flex min-h-9 items-center gap-2 rounded-md bg-teal-700 px-3 text-xs font-semibold text-white hover:bg-teal-800"
                to={`/denials?selected=${primaryDenial.id}&claim=${claim.id}`}
              >
                <Sparkles size={15} /> Analyse Denial with AI
              </Link>
            )}

            {isSpecialistRole && claim.status === "DENIED" && (
              <Link className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50" to={"/evidence?claim=" + claim.id}>
                <FilePlus2 size={15} /> Add Evidence
              </Link>
            )}
          </div>
        }
      />

      {error && <div role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{error}</div>}

      {/* Prominent Denied Claim Notice & Reviewer Rejection Feedback */}
      {claim.status === "DENIED" && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-xs shadow-xs">
          <div className="flex items-start gap-3">
            <FileWarning className="mt-0.5 size-5 shrink-0 text-red-600" />
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-red-900 text-sm">
                  Claim Denied by Insurance Reviewer
                </h3>
                {primaryDenial && (
                  <span className="rounded bg-red-100 px-2 py-0.5 font-bold text-red-800">
                    {primaryDenial.denialReason?.code || "DENIED"}
                  </span>
                )}
              </div>
              <p className="text-red-700 leading-relaxed">
                <strong>Denial Reason:</strong> {primaryDenial?.reasonText || primaryDenial?.denialReason?.title || "Clinical or policy documentation incomplete."}
              </p>
              {claim.claimReviews?.find((r) => r.decision === "DENIED" && r.reviewComments) && (
                <div className="mt-2 rounded bg-white p-2.5 border border-red-200 text-slate-800">
                  <span className="font-bold text-red-800">Reviewer Notes:</span> &ldquo;{claim.claimReviews.find((r) => r.decision === "DENIED" && r.reviewComments).reviewComments}&rdquo;
                </div>
              )}
              {isSpecialistRole && (
                <div className="mt-3 flex flex-wrap gap-2 pt-1 border-t border-red-200/60">
                  <Link
                    to={`/denials?claim=${claim.id}&selected=${primaryDenial?.id || ""}`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-red-800 transition"
                  >
                    <Sparkles size={13} />
                    1. Run AI Denial Analysis &rarr;
                  </Link>
                  <Link
                    to={`/evidence?claim=${claim.id}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 shadow-xs hover:bg-red-50 transition"
                  >
                    2. Upload Evidence &rarr;
                  </Link>
                  <Link
                    to={`/appeals/draft?claim=${claim.id}`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 transition"
                  >
                    3. Appeal Draft Workspace &rarr;
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Prominent Approved Claim Notice */}
      {claim.status === "APPROVED" && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs shadow-xs">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            <div className="flex-1 space-y-1">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-emerald-950 text-sm">
                  Claim Approved & Cleared by Insurance Reviewer
                </h3>
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800 text-[11px] border border-emerald-300">
                    Approved
                  </span>
                  <span className="rounded bg-slate-200 px-2 py-0.5 font-bold text-slate-700 text-[11px]">
                    Closed
                  </span>
                </div>
              </div>
              <p className="text-emerald-800">
                This claim has been verified, approved, and cleared for reimbursement. The case is now closed.
              </p>
              {claim.claimReviews?.find((r) => r.decision === "APPROVED" && r.reviewComments) && (
                <div className="mt-2 rounded bg-white p-2.5 border border-emerald-200 text-slate-800">
                  <span className="font-bold text-emerald-800">Reviewer Notes:</span> &ldquo;{claim.claimReviews.find((r) => r.decision === "APPROVED" && r.reviewComments).reviewComments}&rdquo;
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[1.35fr_.9fr]">
        <div className="grid gap-4">
          {/* Claim Overview Card */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Claim Details"
              description="Patient, hospital, and insurance information"
              action={<StatusBadge status={claim.status} />}
            />
            <div className="grid grid-cols-2 gap-x-5 gap-y-4 p-4 sm:grid-cols-3 sm:p-5">
              <Detail label="Claim Number" value={claim.claimNumber} />
              <Detail label="Patient Full Name" value={claim.patientName || "—"} />
              <Detail label="Hospital Facility" value={claim.hospitalOrganization?.name || claim.hospitalName || "—"} />
              <Detail label="Insurance Company" value={claim.insuranceOrganization?.name || claim.payerName || "—"} />
              <Detail label="Policy Number" value={claim.policyNumber || "—"} />
              <Detail label="Service / Admission Date" value={formatDate(claim.serviceDate)} />
              <Detail label="Diagnosis Code (ICD)" value={claim.diagnosisCode || "—"} />
              <Detail label="Procedure Code (CPT)" value={claim.procedureCode || "—"} />
              <Detail label="Claim Amount" value={formatCurrency(claim.amount, claim.currency)} />
            </div>

            {claim.treatmentDescription && (
              <div className="border-t border-slate-100 p-4 sm:p-5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Treatment Description</span>
                <p className="mt-1 text-xs text-slate-700 leading-relaxed">{claim.treatmentDescription}</p>
              </div>
            )}
          </Card>

          {/* Adjudication Decisions History */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Review History"
              description="Decisions recorded by insurance reviewers"
            />
            {(!claim.claimReviews || claim.claimReviews.length === 0) ? (
              <div className="p-4 text-xs text-slate-400 italic">
                No formal insurance adjudication decision recorded yet. Status: {claim.status}.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 px-4">
                {claim.claimReviews.map((rev) => (
                  <div key={rev.id} className="py-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${rev.decision === "APPROVED" ? "text-emerald-700" : "text-red-700"}`}>
                          {rev.decision}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          by {rev.reviewer?.displayName || rev.reviewer?.email || "Reviewer"}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">{formatDate(rev.createdAt)}</span>
                    </div>

                    {rev.denialCode && (
                      <div className="rounded bg-red-50 p-2 text-red-800">
                        <span className="font-bold">{rev.denialCode}:</span> {rev.denialExplanation}
                      </div>
                    )}

                    {rev.reviewComments && (
                      <p className="text-slate-600 italic">Reviewer Comment: &ldquo;{rev.reviewComments}&rdquo;</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Associated Denials */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Associated Denial Records"
              description="Denial codes and reasons registered against this claim"
            />
            {!claim.denials?.length ? (
              <EmptyState icon={FileWarning} title="No denial records" description="No denials have been registered for this claim." />
            ) : (
              <div className="divide-y divide-slate-100 px-4">
                {claim.denials.map((denial) => (
                  <div key={denial.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="grid size-8 shrink-0 place-items-center rounded-md bg-red-50 text-red-700">
                        <FileWarning size={16} />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-800">
                          {denial.denialReason?.code} &bull; {denial.denialReason?.title}
                        </div>
                        <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">{denial.reasonText}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <StatusBadge status={denial.status} />
                          <span className="text-[10px] text-slate-400">Received {formatDate(denial.denialDate)}</span>
                        </div>
                      </div>
                    </div>
                    {isSpecialistRole && (
                      <Link className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800 hover:underline" to={`/denials?selected=${denial.id}&claim=${claim.id}`}>
                        <Sparkles size={13} /> Ask AI to Analyse Denial &rarr;
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right Sidebar: Documents, Evidence & Appeals */}
        <div className="grid gap-4">
          {/* Supporting Clinical Documents */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Supporting Documents"
              description={`${claim.documents?.length || 0} file(s) attached`}
            />
            {!claim.documents?.length ? (
              <EmptyState
                icon={FileText}
                title="No documents uploaded"
                description="Upload medical records or operative reports to substantiate this claim."
              />
            ) : (
              <div className="divide-y divide-slate-100 px-4">
                {claim.documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between py-2.5 text-xs">
                    <div className="min-w-0 pr-2">
                      <div className="font-semibold text-slate-800 truncate max-w-[200px]">{doc.originalName}</div>
                      <div className="text-[10px] text-slate-400">
                        {doc.type.toLowerCase().replaceAll("_", " ")} &bull; {doc.sizeBytes ? `${(doc.sizeBytes / 1024).toFixed(1)} KB` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={api.documentDownloadUrl(doc.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-50 shadow-2xs transition"
                        title="Open document in new tab"
                      >
                        <ExternalLink size={11} /> Open
                      </a>
                      <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-teal-700">
                        {doc.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Appeal Letters & Revisions */}
          <Card className="p-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-semibold text-slate-700">Appeal Letters</span>
              <span className="text-xs font-bold text-slate-500">{claim.appealLetters?.length || 0} letter(s)</span>
            </div>
            {claim.appealLetters?.length > 0 ? (
              <div className="mt-2 divide-y divide-slate-100 text-xs">
                {claim.appealLetters.map((letter) => (
                  <div key={letter.id} className="py-2 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-800">Rev #{letter.revisionNumber || 1}</span>
                      <div className="text-[10px] text-slate-400">Updated {formatDate(letter.updatedAt)}</div>
                    </div>
                    <StatusBadge status={letter.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">No appeal letters drafted yet.</p>
            )}

            <div className="mt-3 pt-2 border-t border-slate-100">
              {isSpecialistRole ? (
                claim.status === "DENIED" ? (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-bold text-slate-700">Appeal Workflow:</div>
                    <div className="flex flex-wrap gap-1.5">
                      <Link
                        className="inline-flex items-center gap-1 rounded bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-100"
                        to={`/denials?claim=${claim.id}&selected=${primaryDenial?.id || ""}`}
                      >
                        1. Denial Analysis
                      </Link>
                      <Link
                        className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
                        to={`/evidence?claim=${claim.id}`}
                      >
                        2. Evidence
                      </Link>
                      <Link
                        className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                        to={`/appeals/draft?claim=${claim.id}`}
                      >
                        3. Appeal Draft &rarr;
                      </Link>
                    </div>
                  </div>
                ) : claim.status === "APPROVED" ? (
                  <div className="flex items-center justify-between rounded bg-emerald-50 p-2 text-xs text-emerald-900 border border-emerald-200">
                    <div className="flex items-center gap-1.5 font-bold">
                      <CheckCircle2 size={14} className="text-emerald-600" />
                      <span>Case Closed & Approved</span>
                    </div>
                    {claim.appealLetters?.length > 0 && (
                      <Link
                        to={`/appeals/draft?claim=${claim.id}`}
                        className="text-[11px] font-bold text-emerald-800 hover:underline"
                      >
                        View Appeal Draft &rarr;
                      </Link>
                    )}
                  </div>
                ) : null
              ) : (
                <Link className="inline-flex text-xs font-semibold text-indigo-700 hover:underline" to="/reviewer/dashboard">
                  Open Reviewer Desk &rarr;
                </Link>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Adjudicate Claim Modal (Reviewer) */}
      {adjudicateModalOpen && (
        <Modal
          open={true}
          title={`Adjudicate Claim: ${claim.claimNumber}`}
          onClose={() => setAdjudicateModalOpen(false)}
        >
          <div className="space-y-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
              <span className="font-bold text-slate-900">{claim.patientName}</span> &bull; {claim.hospitalOrganization?.name || claim.hospitalName} &bull; <strong className="text-indigo-700">{formatCurrency(claim.amount, claim.currency)}</strong>
            </div>

            {/* Attached Supporting Documents for Reviewer */}
            {claim.documents?.length > 0 && (
              <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 text-xs space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                  <span className="flex items-center gap-1.5">
                    <FileText size={14} className="text-teal-700" />
                    Attached Clinical Documents ({claim.documents.length})
                  </span>
                  <span className="text-[10px] text-slate-500 font-normal">Review before decision</span>
                </div>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {claim.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between rounded bg-white p-2 border border-slate-200">
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-slate-800 truncate text-[11px]">{doc.originalName}</div>
                        <div className="text-[10px] text-slate-400">{doc.type.toLowerCase().replaceAll("_", " ")} &bull; {(doc.sizeBytes / 1024).toFixed(0)} KB</div>
                      </div>
                      <a
                        href={api.documentDownloadUrl(doc.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-100 transition shrink-0"
                      >
                        <ExternalLink size={11} /> Open Document &rarr;
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={decisionMode === "APPROVE" ? "default" : "outline"}
                className={decisionMode === "APPROVE" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
                icon={CheckCircle2}
                onClick={() => setDecisionMode("APPROVE")}
              >
                Approve Claim
              </Button>
              <Button
                type="button"
                variant={decisionMode === "DENY" ? "default" : "outline"}
                className={decisionMode === "DENY" ? "bg-red-600 hover:bg-red-700 text-white" : ""}
                icon={XCircle}
                onClick={() => setDecisionMode("DENY")}
              >
                Deny Claim
              </Button>
            </div>

            {decisionMode === "APPROVE" && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs space-y-2">
                <p className="font-bold text-emerald-900">Confirm Claim Approval</p>
                <input
                  type="text"
                  placeholder="Optional review comment..."
                  className="w-full rounded border border-slate-300 p-2 text-xs"
                  value={reviewComments}
                  onChange={(e) => setReviewComments(e.target.value)}
                />
                <div className="flex justify-end pt-1">
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    loading={submittingReview}
                    onClick={() => handleAdjudicate("APPROVED")}
                  >
                    Confirm Approval
                  </Button>
                </div>
              </div>
            )}

            {decisionMode === "DENY" && (
              <div className="rounded-lg border border-red-200 bg-red-50/50 p-3.5 text-xs space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-red-900">Issue Formal Claim Denial</p>
                  <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800">
                    Rejection Comment Required
                  </span>
                </div>
                <p className="text-[11px] text-red-700">
                  Specify the denial code, policy rule, and mandatory reviewer comment so the hospital specialist understands why this claim was cancelled or denied.
                </p>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Denial Code *</label>
                  <select
                    className="w-full rounded border border-slate-300 bg-white p-2 text-xs"
                    value={denialCode}
                    onChange={(e) => {
                      setDenialCode(e.target.value);
                      const f = COMMON_DENIAL_CODES.find((c) => c.code === e.target.value);
                      if (f) setDenialExplanation(f.explanation);
                    }}
                  >
                    {COMMON_DENIAL_CODES.map((dc) => (
                      <option key={dc.code} value={dc.code}>{dc.code} - {dc.title}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Standard Denial Policy *</label>
                  <textarea
                    rows={2}
                    className="w-full rounded border border-slate-300 bg-white p-2 text-xs text-slate-800"
                    value={denialExplanation}
                    onChange={(e) => setDenialExplanation(e.target.value)}
                  />
                </div>

                <CheckboxMultiSelect
                  label="Missing / Required Clinical Document(s)"
                  options={REQUIRED_DOC_TYPES}
                  selected={missingDocTypes}
                  onChange={handleMissingDocsChange}
                  placeholder="Select missing documents (check all that apply)..."
                />

                <div>
                  <label className="block text-[11px] font-bold text-slate-900 mb-1">
                    Rejection Reason & Reviewer Comment *
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Explain specifically why this claim is being denied/cancelled (e.g. Clinical notes missing pre-operative ECG and angiogram findings; waiting period clause 4.2 applied)..."
                    className="w-full rounded border border-red-300 bg-white p-2.5 text-xs text-slate-800 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                    value={reviewComments}
                    onChange={(e) => setReviewComments(e.target.value)}
                  />
                  <p className="mt-1 text-[10px] text-slate-500">
                    This explanation is shared with the hospital so they understand why the claim was cancelled.
                  </p>
                </div>

                <div className="flex justify-end pt-1">
                  <Button
                    className="bg-red-600 hover:bg-red-700 text-white"
                    loading={submittingReview}
                    onClick={() => handleAdjudicate("DENIED")}
                  >
                    Reject & Issue Denial
                  </Button>
                </div>
              </div>
            )}

            {reviewError && (
              <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                {reviewError}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <Button variant="outline" onClick={() => setAdjudicateModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );

  function Detail({ label, value }) {
    return (
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-1 text-sm font-semibold text-slate-700">{value}</div>
      </div>
    );
  }
}
