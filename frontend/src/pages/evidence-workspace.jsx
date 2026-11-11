import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  FileCheck2,
  Files,
  FileText,
  FileWarning,
  Sparkles,
  Upload,
  UploadCloud,
  CheckCircle2,
  Clock,
  WandSparkles,
  Plus,
  Trash2,
  AlertTriangle,
  Loader2
} from "lucide-react";
import { api } from "../api/client.js";
import { Button, Card, CardHeader, EmptyState, ErrorState, Field, LoadingState, PageHeader, Pill, SelectField, StateMessage } from "../components/ui.jsx";
import { useAuth } from "../context/auth-context.jsx";
import { useToast } from "../context/toast-context.jsx";
import { formatDate, titleCase } from "../lib/format.js";
import { useClaimSync } from "../lib/sync.js";

export const DOCUMENT_TYPES = [
  { value: "CLINICAL_NOTE", label: "Clinical / Operative Note" },
  { value: "IMAGING_REPORT", label: "Imaging / Radiology Report" },
  { value: "LAB_RESULT", label: "Laboratory / Diagnostic Result" },
  { value: "ORDER", label: "Physician Order / Prescription" },
  { value: "AUTHORIZATION", label: "Prior Authorization Request" },
  { value: "REFERRAL", label: "Medical Referral Document" },
  { value: "TREATMENT_HISTORY", label: "Treatment / Discharge Summary" },
  { value: "OTHER", label: "Other Supporting Evidence" }
];

export function EvidenceWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { showToast, notify } = useToast();
  const toast = showToast || notify;
  const navigate = useNavigate();

  const [records, setRecords] = useState({ claims: [], denials: [], evidences: [] });
  const [claimId, setClaimId] = useState(searchParams.get("claim") || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  // Uploaded files state - supports multiple documents via +
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [uploadRows, setUploadRows] = useState([
    { id: 1, file: null, type: searchParams.get("type") || "CLINICAL_NOTE", sourceDate: "" }
  ]);
  const [rowErrors, setRowErrors] = useState({});
  const [validatingRowId, setValidatingRowId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [retryingDocumentId, setRetryingDocumentId] = useState("");
  const [generating, setGenerating] = useState(false);

  function addUploadRow() {
    setUploadRows((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), file: null, type: "CLINICAL_NOTE", sourceDate: "" }
    ]);
  }

  function removeUploadRow(id) {
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setUploadRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  function updateUploadRow(id, field, value) {
    if (field === "file") {
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (value) {
        if (value.size === 0) {
          setRowErrors((prev) => ({
            ...prev,
            [id]: "The uploaded document is empty or contains no readable text. Please upload a valid medical document."
          }));
        } else {
          const name = (value.name || "").toLowerCase();
          if (!name.endsWith(".pdf") && !name.endsWith(".docx")) {
            setRowErrors((prev) => ({
              ...prev,
              [id]: "Invalid Document! The uploaded file does not appear to be a medical or healthcare-related document. Please upload a valid medical document."
            }));
          }
        }
      }
    }
    setUploadRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  const canCreate = ["PROVIDER", "BILLING_SPECIALIST", "ADMIN"].includes(user?.role);

  async function handleGenerateAppeal() {
    if (!claimId) return;
    setGenerating(true);
    try {
      const result = await api.generateAppeal(claimId, { limit: 8 });
      if (result && result.saved === false) {
        const errorMsg = result.validation?.messages?.[0] || "Appeal letter generation failed grounding checks.";
        if (toast) toast(errorMsg, { type: "error" });
        return;
      }
      const letter = result?.letter || result?.data?.letter;
      if (toast) toast("Grounded appeal letter formulated! Opening Appeal Workspace...", { type: "success" });
      if (letter?.id) {
        navigate(`/appeals/draft?claim=${encodeURIComponent(claimId)}&letter=${encodeURIComponent(letter.id)}`);
      } else {
        navigate(`/appeals/draft?claim=${encodeURIComponent(claimId)}`);
      }
    } catch (err) {
      if (toast) toast(err.message || "Failed to generate appeal letter.", { type: "error" });
    } finally {
      setGenerating(false);
    }
  }

  // Load claims, denials, and evidences (scoped strictly to denied claims)
  const load = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError("");
    try {
      const [claims, denials, evidences] = await Promise.all([
        api.claims({ page: 1, limit: 50 }),
        api.denials({ page: 1, limit: 50 }),
        api.evidences({ page: 1, limit: 50 })
      ]);
      const allClaims = claims.data || [];
      const openDenials = (denials.data || []).filter((d) => d.status !== "RESOLVED" && d.status !== "CLOSED" && d.claim?.status !== "APPROVED");
      const deniedClaimIds = new Set(openDenials.map((d) => d.claimId));
      // Only include claims that are actively DENIED (matching AI Denial Analysis)
      const claimRows = allClaims.filter((claim) => claim.status === "DENIED" || deniedClaimIds.has(claim.id));

      const paramClaim = searchParams.get("claim");
      const preferredClaim = claimRows.find((claim) => claim.id === paramClaim)?.id || claimRows[0]?.id || "";
      setRecords({ claims: claimRows, denials: openDenials, evidences: evidences.data || [] });
      setClaimId((current) => claimRows.some((claim) => claim.id === current) ? current : preferredClaim);
    } catch (failure) {
      if (!isSilent) setError(failure.message);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [revision, searchParams]);

  useEffect(() => {
    load(false);
  }, [load]);

  // Synchronize across tabs and poll every 3 seconds
  useClaimSync(() => {
    if (!uploading) {
      load(true);
    }
  }, 3000);

  // Load uploaded documents when claimId changes
  useEffect(() => {
    if (!claimId) {
      setDocuments([]);
      return;
    }
    setDocumentsLoading(true);
    api.documents(claimId)
      .then((res) => {
        setDocuments(res.data || []);
      })
      .catch((err) => {
        setDocuments([]);
      })
      .finally(() => {
        setDocumentsLoading(false);
      });
  }, [claimId, revision]);

  const selectedClaim = useMemo(
    () => records.claims.find((item) => item.id === claimId) || null,
    [records.claims, claimId]
  );

  const claimEvidences = useMemo(
    () => records.evidences.filter((item) => item.claimId === claimId),
    [records.evidences, claimId]
  );

  async function submitDocument(event) {
    event.preventDefault();
    setUploadError("");
    if (!claimId) {
      setUploadError("Please select an active claim.");
      return;
    }
    const validRows = uploadRows.filter((r) => Boolean(r.file));
    if (validRows.length === 0) {
      setUploadError("Please choose at least one medical document file to upload.");
      return;
    }

    setUploading(true);
    let successCount = 0;
    const errors = [];
    const successfulRowIds = new Set();
    const newRowErrors = { ...rowErrors };

    for (const row of validRows) {
      setValidatingRowId(row.id);

      // Client-side quick check
      if (row.file.size === 0) {
        const msg = "The uploaded document is empty or contains no readable text. Please upload a valid medical document.";
        newRowErrors[row.id] = msg;
        errors.push(`${row.file.name}: ${msg}`);
        continue;
      }
      const fname = (row.file.name || "").toLowerCase();
      if (!fname.endsWith(".pdf") && !fname.endsWith(".docx")) {
        const msg = "Invalid Document! The uploaded file does not appear to be a medical or healthcare-related document. Please upload a valid medical document.";
        newRowErrors[row.id] = msg;
        errors.push(`${row.file.name}: ${msg}`);
        continue;
      }

      try {
        await api.uploadDocument(claimId, {
          file: row.file,
          type: row.type,
          sourceDate: row.sourceDate || undefined
        });
        successCount++;
        successfulRowIds.add(row.id);
        delete newRowErrors[row.id];
      } catch (failure) {
        const msg = failure.message || "Invalid Document! The uploaded file does not appear to be a medical or healthcare-related document. Please upload a valid medical document.";
        newRowErrors[row.id] = msg;
        errors.push(`${row.file.name}: ${msg}`);
      }
    }

    setValidatingRowId(null);
    setRowErrors(newRowErrors);

    if (successCount > 0) {
      if (toast) toast(`Successfully processed and indexed ${successCount} document(s).`, { type: "success" });
      setRevision((v) => v + 1);
    }

    if (successfulRowIds.size === validRows.length && uploadRows.length === validRows.length) {
      // All rows succeeded
      setUploadRows([{ id: Date.now(), file: null, type: "CLINICAL_NOTE", sourceDate: "" }]);
      setUploadInputKey((v) => v + 1);
      setRowErrors({});
      setUploadError("");
    } else {
      // Keep only failed or empty rows so user can fix or remove them
      setUploadRows((prev) => {
        const remaining = prev.filter((r) => !successfulRowIds.has(r.id));
        return remaining.length > 0 ? remaining : [{ id: Date.now(), file: null, type: "CLINICAL_NOTE", sourceDate: "" }];
      });
      if (errors.length > 0) {
        setUploadError(errors.length === 1 ? errors[0] : `${errors.length} document(s) could not be uploaded. Please review the errors below.`);
      }
      setRevision((v) => v + 1);
    }
    setUploading(false);
  }

  async function retryDocument(doc) {
    setRetryingDocumentId(doc.id);
    setUploadError("");
    try {
      const result = await api.retryDocument(claimId, doc.id);
      if (toast) toast(`Document reprocessed and indexed (${result.indexedChunkCount || 1} chunks).`, { type: "success" });
      setRevision((v) => v + 1);
    } catch (failure) {
      setUploadError(failure.message);
    } finally {
      setRetryingDocumentId("");
      setRevision((v) => v + 1);
    }
  }

  if (loading && records.claims.length === 0) {
    return (
      <>
        <PageHeader title="Evidence Workspace" description="Review evidence completeness and upload supporting medical records." />
        <LoadingState label="Loading evidence records..." />
      </>
    );
  }

  if (error && records.claims.length === 0) {
    return (
      <>
        <PageHeader title="Evidence Workspace" description="Review evidence completeness and upload supporting medical records." />
        <ErrorState message={error} onRetry={() => setRevision((v) => v + 1)} />
      </>
    );
  }

  if (records.claims.length === 0 || !selectedClaim) {
    return (
      <>
        <PageHeader
          eyebrow="Clinical Evidence Repository"
          title="Evidence Workspace"
          description="Review evidence completeness and upload supporting medical records for denied claims."
        />
        <Card>
          <EmptyState
            icon={Files}
            title="No denied claims requiring evidence"
            description="Claims denied by insurance compliance reviewers will appear here for evidence attachment and appeal formulation."
            action={
              <Link to="/claims" className="text-xs font-semibold text-teal-800 hover:underline">
                View claims &rarr;
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Clinical Evidence Repository"
        title="Evidence Workspace"
        description="Upload clinical records, manage verified evidence, and review source documents for Ollama AI appeal letters."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/denials?claim=${claimId}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs"
            >
              <ArrowLeft size={13} /> Denial Analysis
            </Link>
            <Link
              to={`/appeals/draft?claim=${claimId}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 shadow-xs"
            >
              Draft Appeal Letter <ArrowRight size={13} />
            </Link>
          </div>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {error}
        </div>
      )}

      {/* Claim Selection Control */}
      <div className="mb-4">
        <SelectField
          label="Active Denied Claim"
          name="evidenceClaim"
          value={claimId}
          onChange={(event) => {
            const newClaimId = event.target.value;
            setClaimId(newClaimId);
            setSearchParams({ claim: newClaimId });
          }}
        >
          <option value="">Select a denied claim...</option>
          {records.claims.map((claim) => (
            <option value={claim.id} key={claim.id}>
              {claim.claimNumber} · {claim.patientName || "Patient"} ({claim.insuranceOrganization?.name || claim.payerName || "Insurance"}) — DENIED
            </option>
          ))}
        </SelectField>
      </div>

      {/* Upload Source Documents Card (Multi-Document Upload Supported) */}
      {canCreate && claimId && (
        <Card className="mb-6 overflow-hidden">
          <CardHeader
            title="Upload Clinical Rebuttal Documents"
            description="Upload medical records, operative notes, lab panels, or imaging reports to substantiate and overturn the claim denial."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={Plus}
                className="border-teal-600 text-teal-800 hover:bg-teal-50"
                onClick={addUploadRow}
              >
                Add Another Document
              </Button>
            }
          />
          <form onSubmit={submitDocument} className="p-4 space-y-4">
            {uploadError && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {uploadError}
              </div>
            )}

            <div className="space-y-3">
              {uploadRows.map((row, idx) => {
                const hasError = Boolean(rowErrors[row.id]);
                const isValidating = validatingRowId === row.id;
                return (
                  <div
                    key={row.id}
                    className={`rounded-lg border p-3 text-xs space-y-3 transition ${
                      hasError
                        ? "border-red-300 bg-red-50/30 shadow-xs"
                        : isValidating
                        ? "border-teal-400 bg-teal-50/30 shadow-xs"
                        : "border-slate-200 bg-slate-50/70"
                    }`}
                  >
                    <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                      <span className="font-bold text-slate-800 flex items-center gap-1.5">
                        <span className={`grid size-5 place-items-center rounded-full text-white text-[10px] font-bold ${hasError ? "bg-red-600" : "bg-teal-700"}`}>
                          {idx + 1}
                        </span>
                        Clinical Document #{idx + 1}
                      </span>
                      {uploadRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeUploadRow(row.id)}
                          className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition cursor-pointer flex items-center gap-1 text-[11px]"
                          title="Remove Document"
                        >
                          <Trash2 size={13} /> Remove
                        </button>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Document Classification *
                        </label>
                        <select
                          value={row.type}
                          onChange={(e) => updateUploadRow(row.id, "type", e.target.value)}
                          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-teal-500 focus:outline-none"
                        >
                          {DOCUMENT_TYPES.map((dt) => (
                            <option key={dt.value} value={dt.value}>
                              {dt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Clinical Document Date
                        </label>
                        <input
                          type="date"
                          value={row.sourceDate}
                          onChange={(e) => updateUploadRow(row.id, "sourceDate", e.target.value)}
                          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-teal-500 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-2 space-y-2">
                        <label className="block text-[11px] font-semibold text-slate-700">
                          Select Medical Document (PDF or DOCX) *
                        </label>
                        <input
                          type="file"
                          key={`${uploadInputKey}-${row.id}`}
                          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          onChange={(e) => updateUploadRow(row.id, "file", e.target.files?.[0] || null)}
                          className="min-h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-teal-700 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-white hover:file:bg-teal-800 cursor-pointer"
                        />

                        {isValidating && (
                          <div className="flex items-center gap-2 rounded-md bg-teal-50 px-3 py-2 text-xs text-teal-900 border border-teal-200 animate-pulse">
                            <Loader2 size={14} className="animate-spin text-teal-700 shrink-0" />
                            <span className="font-semibold">Validating document content against clinical & healthcare requirements...</span>
                          </div>
                        )}

                        {hasError && (
                          <div role="alert" className="flex items-start justify-between gap-3 rounded-md bg-red-100/90 p-2.5 text-xs text-red-900 border border-red-300">
                            <div className="flex items-start gap-2 min-w-0">
                              <AlertTriangle size={16} className="text-red-700 shrink-0 mt-0.5" />
                              <div className="min-w-0">
                                <div className="font-bold text-red-950">Invalid Document Detected</div>
                                <div className="mt-0.5 text-[11px] leading-relaxed text-red-900 font-medium">{rowErrors[row.id]}</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                updateUploadRow(row.id, "file", null);
                                setUploadInputKey((v) => v + 1);
                              }}
                              className="shrink-0 rounded bg-white px-2.5 py-1 text-[11px] font-bold text-red-700 border border-red-300 hover:bg-red-50 hover:border-red-400 transition cursor-pointer shadow-2xs"
                            >
                              Clear / Replace
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={Plus}
                className="border-teal-600 text-teal-800 hover:bg-teal-50"
                onClick={addUploadRow}
              >
                + Add Another Document
              </Button>

              <Button
                type="submit"
                className="bg-teal-700 hover:bg-teal-800 text-white font-medium shadow-xs"
                icon={UploadCloud}
                loading={uploading}
                disabled={uploading}
              >
                {uploading
                  ? "Extracting & Indexing..."
                  : `Upload & Process ${uploadRows.filter((r) => r.file).length > 1 ? `${uploadRows.filter((r) => r.file).length} Documents` : "Document"}`}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Uploaded Documents List */}
      <Card className="mb-6 overflow-hidden">
        <CardHeader
          title="Uploaded Documents & Files"
          description={documentsLoading ? "Loading document status..." : `${documents.length} document(s) on file for Claim ${selectedClaim?.claimNumber || claimId}`}
        />
        {!claimId ? (
          <EmptyState icon={Files} title="Select a claim" description="Choose a claim to inspect its uploaded documents." />
        ) : documentsLoading ? (
          <LoadingState label="Loading uploaded documents..." />
        ) : documents.length === 0 ? (
          <EmptyState
            icon={Files}
            title="No uploaded documents yet"
            description="Upload source medical records (operative notes, lab reports, imaging) to substantiate the appeal."
          />
        ) : (
          <div className="divide-y divide-slate-100 px-4">
            {documents.map((document) => (
              <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="grid size-8 place-items-center rounded bg-slate-100 text-slate-600 shrink-0">
                    <FileText size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-slate-900">
                      {document.originalName}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500 flex items-center gap-2">
                      <span className="font-semibold text-teal-800 uppercase">{document.type?.toLowerCase()?.replaceAll("_", " ")}</span>
                      <span>&bull;</span>
                      <span>{document.pageCount ? `${document.pageCount} page(s) &bull; ` : ""}{(document.sizeBytes / 1024).toFixed(0)} KB</span>
                      <span>&bull;</span>
                      <span>Uploaded {formatDate(document.createdAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Pill tone={document.status === "INDEXED" ? "green" : document.status === "FAILED" ? "red" : "amber"}>
                    {titleCase(document.status)}
                  </Pill>

                  {/* Direct Document View / Download Link */}
                  <a
                    href={api.documentDownloadUrl(document.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                  >
                    <ExternalLink size={11} /> Open File
                  </a>

                  {["FAILED", "EXTRACTED", "UPLOADED"].includes(document.status) && canCreate && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={retryingDocumentId === document.id}
                      disabled={Boolean(retryingDocumentId)}
                      onClick={() => retryDocument(document)}
                    >
                      {document.status === "UPLOADED" ? "Extract & Index" : "Retry"}
                    </Button>
                  )}
                </div>
                {document.processingError && (
                  <span className="w-full text-[10px] text-amber-800 pl-11">
                    {document.processingError.replaceAll("_", " ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Next Step Action Prompt */}
      {claimId && (
        selectedClaim?.status === "APPROVED" ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 p-4 sm:p-5 shadow-2xs">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-950">
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
              Claim is Approved & Cleared
            </div>
            <p className="mt-1 text-xs text-emerald-800 leading-relaxed max-w-xl">
              This claim has already been approved by the insurance compliance reviewer and finalized. No appeal is required.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-teal-200 bg-gradient-to-r from-teal-50/90 to-indigo-50/70 p-4 sm:p-5 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-teal-950">
                  <Sparkles size={16} className="text-teal-700" />
                  Medical Evidence Attached — Ready to Formulate Appeal
                </div>
                <p className="mt-1 text-xs text-slate-600 max-w-xl">
                  Click below to formulate a grounded appeal letter citing your uploaded documents. You can review, edit the text, and submit the draft to the reviewer.
                </p>
              </div>
              <Button
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold shrink-0 shadow-2xs"
                icon={WandSparkles}
                loading={generating}
                onClick={handleGenerateAppeal}
              >
                Generate Grounded Appeal Letter &rarr;
              </Button>
            </div>
          </div>
        )
      )}
    </>
  );
}
