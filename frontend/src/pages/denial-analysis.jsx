import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { 
  ArrowLeft, 
  Check, 
  CheckCircle2, 
  FileCheck2,
  FileSearch2, 
  FileText, 
  FileWarning, 
  ShieldAlert, 
  Sparkles, 
  Upload, 
  WandSparkles,
  AlertTriangle,
  Building2,
  Calendar,
  Layers
} from "lucide-react";
import { api } from "../api/client.js";
import { Button, Card, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader, Pill, StateMessage, StatusBadge, StatusPill } from "../components/ui.jsx";
import { useAuth } from "../context/auth-context.jsx";
import { useToast } from "../context/toast-context.jsx";
import { formatCurrency, formatDate, titleCase } from "../lib/format.js";
import { useClaimSync } from "../lib/sync.js";

const DOCUMENT_TYPES = [
  { value: "CLINICAL_NOTE", label: "Clinical / Operative Note" },
  { value: "IMAGING_REPORT", label: "Imaging / Radiology / Angiogram Report" },
  { value: "LAB_RESULT", label: "Laboratory / Diagnostic Result (ECG)" },
  { value: "ORDER", label: "Physician Order / Prescription" },
  { value: "AUTHORIZATION", label: "Prior Authorization Document" },
  { value: "REFERRAL", label: "Medical Referral Document" },
  { value: "TREATMENT_HISTORY", label: "Treatment / Discharge Summary" },
  { value: "OTHER", label: "Other Supporting Evidence" }
];

export function DenialAnalysisPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast, notify } = useToast();
  const toast = showToast || notify;

  const [denials, setDenials] = useState([]);
  const [selectedId, setSelectedId] = useState(searchParams.get("selected") || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  // Claim details & documents for the selected denial
  const [claimDocuments, setClaimDocuments] = useState([]);
  const [claimLoading, setClaimLoading] = useState(false);

  // AI Denial Analysis State
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiError, setAiError] = useState("");

  // Appeal Generation State
  const [generatingAppeal, setGeneratingAppeal] = useState(false);

  // Toggle list drawer if user wants to switch denial
  const [showDenialSelector, setShowDenialSelector] = useState(false);

  const loadDenials = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError("");
    try {
      const claimParam = searchParams.get("claim");
      const targetSelected = searchParams.get("selected");
      // Load all open denials for this organization (excluding resolved denials or already approved claims)
      const result = await api.denials({ page: 1, limit: 50 });
      const rows = (result.data || []).filter((d) => d.status !== "RESOLVED" && d.status !== "CLOSED" && d.claim?.status !== "APPROVED");
      setDenials(rows);

      if (rows.length === 0) {
        setSelectedId("");
        return;
      }

      // Match target denial: prioritize exact selected ID, then claim ID, then default to first
      const match = rows.find((d) => (targetSelected && d.id === targetSelected) || (claimParam && d.claimId === claimParam));
      if (match) {
        setSelectedId(match.id);
      } else if (!rows.some((d) => d.id === selectedId)) {
        setSelectedId(rows[0].id);
      }
    } catch (failure) {
      if (!isSilent) setError(failure.message);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [revision, searchParams, selectedId]);

  useEffect(() => {
    loadDenials(false);
  }, [loadDenials]);

  // Synchronize across tabs and poll every 3 seconds
  useClaimSync(() => {
    if (!aiLoading && !generatingAppeal) {
      loadDenials(true);
    }
  }, 3000);

  const selected = useMemo(() => {
    return denials.find((item) => item.id === selectedId) || denials[0] || null;
  }, [denials, selectedId]);

  // Load claim documents & evidence when selected denial changes
  useEffect(() => {
    if (!selected?.claimId) {
      setClaimDocuments([]);
      setAiAnalysis(null);
      return;
    }

    let active = true;
    setClaimLoading(true);

    api.documents(selected.claimId)
      .then((docsRes) => {
        if (active) {
          setClaimDocuments(docsRes.data || []);
        }
      })
      .catch(() => {
        if (active) setClaimDocuments([]);
      })
      .finally(() => {
        if (active) setClaimLoading(false);
      });

    return () => { active = false; };
  }, [selected?.claimId, revision]);

  // Automatically trigger AI analysis when a denial is selected
  useEffect(() => {
    if (selected?.id) {
      handleRunAiAnalysis();
    }
  }, [selected?.id]);

  // Run AI Denial Analysis
  async function handleRunAiAnalysis() {
    if (!selected) return;
    setAiLoading(true);
    setAiError("");
    try {
      const result = await api.analyzeDenial(selected.claimId, { denialId: selected.id });
      setAiAnalysis(result);
      if (toast) {
        toast("AI analysis completed successfully.", { type: "success" });
      }
    } catch (err) {
      setAiError(err.message || "Failed to run AI denial analysis.");
      if (toast) toast(err.message || "AI analysis failed.", { type: "error" });
    } finally {
      setAiLoading(false);
    }
  }

  // Handle generating the appeal letter draft
  async function handleGenerateAppeal() {
    if (!selected) return;
    setGeneratingAppeal(true);
    try {
      const genKey = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `gen-${Date.now()}`;
      const res = await api.generateAppeal(selected.claimId, {
        denialId: selected.id,
        searchQuery: selected.denialReason?.title || "denial appeal",
        generationKey: genKey
      });

      if (res && res.saved === false) {
        const errorMsg = res.validation?.messages?.[0] || "Appeal letter generation failed grounding checks. Please verify attached clinical records.";
        if (toast) toast(errorMsg, { type: "error" });
        return;
      }

      const letterId = res?.letter?.id || res?.data?.letter?.id;
      if (toast) {
        toast("Appeal letter drafted! Proceeding to appeal draft workspace...", { type: "success" });
      }

      if (letterId) {
        navigate(`/appeals/draft?claim=${selected.claimId}&letter=${letterId}`);
      } else {
        navigate(`/appeals/draft?claim=${selected.claimId}`);
      }
    } catch (err) {
      if (toast) toast(err.message || "Failed to generate appeal letter draft.", { type: "error" });
    } finally {
      setGeneratingAppeal(false);
    }
  }

  if (loading && denials.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Denial Management" title="AI Denial Analysis" description="Loading denial records..." />
        <LoadingState label="Loading claim denial..." />
      </>
    );
  }

  if (error && denials.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Denial Management" title="AI Denial Analysis" description="Could not load denial." />
        <ErrorState message={error} onRetry={() => setRevision((v) => v + 1)} />
      </>
    );
  }

  if (!selected) {
    return (
      <>
        <PageHeader eyebrow="Denial Management" title="AI Denial Analysis" description="No active denial found." />
        <Card>
          <EmptyState
            icon={FileSearch2}
            title="No denial records to analyze"
            description="Denials registered by insurance compliance reviewers will appear here."
            action={<Link to="/claims" className="text-xs font-semibold text-teal-800 hover:underline">View claims</Link>}
          />
        </Card>
      </>
    );
  }

  const claim = selected.claim;
  const isResolvedOrApproved = selected.status === "RESOLVED" || claim?.status === "APPROVED";
  const reviewerFeedback = selected.reasonText?.includes("Reviewer Comment:")
    ? selected.reasonText.split("Reviewer Comment:")[1].trim()
    : selected.reasonText;

  return (
    <div className="space-y-4">
      {/* Top Breadcrumb & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <Link
            to="/claims"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
          >
            <ArrowLeft size={14} /> Back to Claims Management
          </Link>
          <Link
            to={`/claims/${selected.claimId}`}
            className="inline-flex items-center gap-1 rounded-md border border-transparent px-2.5 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50 transition"
          >
            View Full Claim Details
          </Link>
        </div>

        {denials.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              Showing denial for <strong className="text-slate-800">{claim.claimNumber}</strong>
            </span>
            <button
              type="button"
              onClick={() => setShowDenialSelector(!showDenialSelector)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800 hover:underline"
            >
              <Layers size={13} />
              {showDenialSelector ? "Hide denial list" : `Switch denial (${denials.length} available)`}
            </button>
          </div>
        )}
      </div>

      {/* Optional Denial Switcher Drawer (if multiple denials exist and user explicitly expands) */}
      {showDenialSelector && denials.length > 1 && (
        <Card className="p-3 bg-slate-50/70 border-slate-200">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">
            Select another claim denial to analyze:
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-48 overflow-y-auto">
            {denials.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setSelectedId(d.id);
                  setSearchParams({ selected: d.id, claim: d.claimId });
                  setShowDenialSelector(false);
                }}
                className={`flex items-center justify-between rounded-lg border p-2.5 text-left text-xs transition ${
                  selected.id === d.id
                    ? "border-teal-400 bg-teal-50 text-teal-900 font-semibold"
                    : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                }`}
              >
                <div>
                  <div className="font-bold">{d.claim?.claimNumber}</div>
                  <div className="text-[10px] text-slate-500 truncate max-w-[180px]">{d.denialReason?.title}</div>
                </div>
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">
                  {d.denialReason?.code}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Main Single Denial Focus Workspace */}
      <div className="grid gap-4">
        {/* Card 1: Insurer Determination & Reviewer Rejection Card */}
        <Card className={`overflow-hidden ${isResolvedOrApproved ? "border-emerald-300" : "border-red-200"}`}>
          <div className={`border-b p-4 sm:p-5 ${isResolvedOrApproved ? "border-emerald-200 bg-emerald-50/70" : "border-red-100 bg-red-50/60"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`rounded-md px-2.5 py-1 text-xs font-bold text-white tracking-wide ${isResolvedOrApproved ? "bg-emerald-700" : "bg-red-600"}`}>
                  {selected.denialReason?.code}
                </span>
                <StatusBadge status={selected.status} />
                <span className="text-xs text-slate-500">
                  Issued on {formatDate(selected.denialDate)}
                </span>
              </div>

              {!isResolvedOrApproved && (
                <div className="flex items-center gap-2">
                  <Button
                    className="bg-teal-700 hover:bg-teal-800 text-white shadow-xs"
                    icon={Sparkles}
                    loading={aiLoading}
                    onClick={handleRunAiAnalysis}
                  >
                    {aiAnalysis ? "Re-Run AI Denial Analysis" : "Run AI Denial Analysis"}
                  </Button>
                </div>
              )}
            </div>

            <h1 className="mt-3 text-lg font-bold tracking-tight text-slate-900">
              {selected.denialReason?.title}
            </h1>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed max-w-3xl">
              {selected.denialReason?.description}
            </p>
          </div>

          {/* Claim Metadata Grid */}
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5 border-b border-slate-100 bg-slate-50/40 text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400">Claim Number</span>
              <p className="font-semibold text-slate-800">{claim.claimNumber}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400">Patient Full Name</span>
              <p className="font-semibold text-slate-800">{claim.patientName || "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400">Insurance Company</span>
              <p className="font-semibold text-slate-800">{claim.insuranceOrganization?.name || claim.payerName || "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400">Claim Amount</span>
              <p className="font-bold text-indigo-700">{formatCurrency(claim.amount, claim.currency)}</p>
            </div>
          </div>

          {/* Reviewer Rejection Note Banner */}
          <div className="p-4 sm:p-5">
            {isResolvedOrApproved ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-emerald-950 text-xs">
                        Denial Overturned & Resolved — Claim Approved
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
                    <p className="text-xs text-emerald-900 leading-relaxed font-medium">
                      The insurance compliance reviewer has verified the evidence and approved the appeal. The denial has been resolved and the case is closed.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <div className="flex items-start gap-3">
                  <FileWarning className="mt-0.5 size-5 shrink-0 text-red-600" />
                  <div className="flex-1 space-y-1">
                    <h3 className="font-bold text-red-950 text-xs flex items-center justify-between">
                      <span>Insurer Compliance Reviewer Rejection Comment & Audit Feedback</span>
                      <span className="rounded bg-red-200/80 px-2 py-0.5 text-[10px] font-semibold text-red-900">
                        Reason Claim was Denied / Cancelled
                      </span>
                    </h3>
                    <p className="text-xs text-red-900 leading-relaxed font-medium">
                      &ldquo;{reviewerFeedback}&rdquo;
                    </p>
                    <p className="pt-1 text-[11px] text-red-700">
                      Use this auditor feedback to identify the missing evidence or diagnostic reports required to formulate a successful appeal.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* AI Denial Analysis Interactive Section */}
        {aiLoading && (
          <Card className="p-8 text-center border-teal-200 bg-teal-50/20">
            <div className="mx-auto size-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
            <h3 className="mt-3 text-sm font-bold text-slate-900">AI is Analyzing the Claim Denial...</h3>
            <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
              Cross-examining uploaded hospital files with the reviewer&apos;s objection (&ldquo;{reviewerFeedback?.slice(0, 70)}...&rdquo;) and payer policy rules.
            </p>
          </Card>
        )}

        {aiError && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800">
            <strong>AI Analysis Error:</strong> {aiError}
          </div>
        )}

        {aiAnalysis && !aiLoading && (
          <Card className="overflow-hidden border-teal-300 shadow-sm ring-1 ring-teal-500/20">
            <div className="border-b border-teal-100 bg-teal-50/60 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-md bg-teal-700 text-white">
                    <Sparkles size={16} />
                  </span>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">AI Denial & Evidence Evaluation</h2>
                    <p className="text-[11px] text-teal-800">Automated audit based on reviewer comments & medical necessity rules</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {aiAnalysis.readyForAppeal ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                      <CheckCircle2 size={14} className="text-emerald-600" /> Evidence Complete
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                      <AlertTriangle size={14} className="text-amber-600" /> Missing Documents Detected
                    </span>
                  )}
                </div>
              </div>

              {/* AI Summary Statement */}
              <div className="mt-3 rounded-lg border border-teal-200 bg-white p-3.5 text-xs text-slate-800 leading-relaxed shadow-2xs">
                <strong>AI Finding:</strong> {aiAnalysis.analysisSummary?.replaceAll("GLM", "Ollama")}
              </div>
            </div>

            <div className="p-4 sm:p-5 space-y-5">
              {/* Missing Documents Guidance */}
              {aiAnalysis.missingDocuments?.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <FileWarning size={15} className="text-amber-600" />
                      Documents Required to Overturn Denial ({aiAnalysis.missingDocuments.length} missing)
                    </h3>
                    <span className="text-[11px] text-slate-500">Based on reviewer feedback and clinical rules</span>
                  </div>

                    <div className="grid gap-3">
                      {aiAnalysis.missingDocuments.map((item, idx) => (
                        <div key={idx} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                                {item.type}
                              </span>
                              <span className="font-bold text-slate-900">{item.label}</span>
                            </div>
                            <span className="text-[10px] font-bold uppercase text-amber-800">
                              {item.priority}
                            </span>
                          </div>
                          <p className="text-slate-700 text-[11px] pt-0.5">
                            <strong className="text-slate-900">Why it is needed:</strong> {item.reason}
                          </p>
                          <p className="text-teal-900 text-[11px] font-medium">
                            &rarr; <strong>Recommended Action:</strong> {item.action}
                          </p>
                          <div className="pt-2 flex flex-wrap items-center justify-end gap-2">
                            <Button
                              size="sm"
                              className="bg-teal-700 hover:bg-teal-800 text-white font-medium shadow-2xs"
                              icon={Upload}
                              onClick={() => navigate(`/evidence?claim=${selected.claimId}&denial=${selected.id}&type=${encodeURIComponent(item.type || "")}`)}
                            >
                              Upload in Evidence Workspace &rarr;
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Upload Missing Documents in Evidence Workspace Primary Action */}
                    <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-3 rounded-lg border border-teal-300 bg-teal-50/60 p-3.5 shadow-2xs">
                      <div>
                        <span className="font-bold text-xs text-slate-900 block">
                          Upload Required Clinical Evidence
                        </span>
                        <span className="text-[11px] text-slate-600">
                          Move to the Evidence Workspace to upload and verify documents against denial rules using AI.
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          className="bg-teal-700 hover:bg-teal-800 text-white font-medium"
                          icon={Upload}
                          onClick={() => navigate(`/evidence?claim=${selected.claimId}&denial=${selected.id}`)}
                        >
                          Upload in Evidence Workspace &rarr;
                        </Button>
                      </div>
                    </div>
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-700 shrink-0" />
                  <span>
                    <strong>Clinical Evidence Fully Substantiated:</strong> All required documents and diagnostic records needed to address the reviewer&apos;s objection are available on file.
                  </span>
                </div>
              )}

              {/* Ready to Generate Appeal Letter Prompt Banner / Approved Banner */}
              {isResolvedOrApproved ? (
                <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-950">
                        <CheckCircle2 size={16} className="text-emerald-600" />
                        Appeal Approved & Finalized by Insurance Reviewer
                      </div>
                      <p className="text-xs text-slate-600 max-w-xl">
                        This claim has been verified, approved, and cleared for reimbursement. The initial denial has been resolved and the case is closed.
                      </p>
                    </div>
                    <Button
                      size="lg"
                      className="bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs shrink-0 cursor-pointer"
                      icon={FileCheck2}
                      onClick={() => navigate(`/appeals/draft?claim=${selected.claimId}`)}
                    >
                      View Approved Appeal &rarr;
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50/90 to-teal-50/70 p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950">
                        <WandSparkles size={16} className="text-indigo-600" />
                        Ready to Generate Grounded Appeal Letter?
                      </div>
                      <p className="text-xs text-slate-600 max-w-xl">
                        AI will formulate a formal appeal letter refuting denial code <strong>{selected.denialReason?.code}</strong>, incorporating citations from your uploaded clinical records, and directly answering the reviewer&apos;s objection.
                      </p>
                    </div>

                    <Button
                      size="lg"
                      className="bg-teal-700 hover:bg-teal-800 text-white shadow-xs cursor-pointer font-bold shrink-0"
                      icon={Sparkles}
                      loading={generatingAppeal}
                      onClick={handleGenerateAppeal}
                    >
                      {generatingAppeal ? "Formulating Grounded Appeal Draft..." : "Generate Grounded Appeal Letter \u2192"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Card 2: Uploaded Supporting Documents on Claim */}
        <Card className="overflow-hidden">
          <CardHeader
            title={`Uploaded Clinical Documents (${claimDocuments.length})`}
            description="Documentation currently on file for this claim"
            action={
              <Button
                size="sm"
                variant="outline"
                icon={Upload}
                onClick={() => navigate(`/evidence?claim=${encodeURIComponent(selected.claimId)}&denial=${encodeURIComponent(selected.id)}`)}
              >
                Upload Documents &rarr;
              </Button>
            }
          />
          {claimLoading ? (
            <div className="p-4"><LoadingState label="Loading claim documents..." /></div>
          ) : claimDocuments.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No clinical documents uploaded yet"
              description="Upload pre-operative reports, angiogram studies, or lab tests to substantiate this claim."
              action={
                <Button
                  size="sm"
                  icon={Upload}
                  onClick={() => navigate(`/evidence?claim=${encodeURIComponent(selected.claimId)}&denial=${encodeURIComponent(selected.id)}`)}
                >
                  Upload in Evidence Workspace &rarr;
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-slate-100 px-4">
              {claimDocuments.map((doc) => (
                <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
                  <div className="flex items-center gap-2.5">
                    <FileText size={16} className="text-teal-700 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-800">{doc.originalName}</div>
                      <div className="text-[10px] text-slate-400">
                        {titleCase(doc.type)} &bull; {doc.sizeBytes ? `${(doc.sizeBytes / 1024).toFixed(1)} KB` : ""} &bull; {formatDate(doc.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-700">
                      {doc.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
