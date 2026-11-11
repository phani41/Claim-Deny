import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";
import { ClipboardList, Plus, Search, Upload, X, Building2, Shield, Sparkles, CheckCircle2 } from "lucide-react";
import { api } from "../api/client.js";
import { Button, Card, EmptyState, ErrorState, Field, LoadingState, PageHeader, Pagination, SelectField, StatusBadge } from "../components/ui.jsx";
import { useAuth } from "../context/auth-context.jsx";
import { useToast } from "../context/toast-context.jsx";
import { formatCurrency, formatDate } from "../lib/format.js";
import { broadcastClaimUpdate, useClaimSync } from "../lib/sync.js";

const DOCUMENT_TYPES = [
  { value: "CLINICAL_NOTE", label: "Clinical / Operative Note" },
  { value: "IMAGING_REPORT", label: "Imaging / Radiology Report" },
  { value: "LAB_RESULT", label: "Laboratory / Diagnostic Result" },
  { value: "ORDER", label: "Physician Order / Prescription" },
  { value: "AUTHORIZATION", label: "Prior Authorization Request" },
  { value: "REFERRAL", label: "Medical Referral Document" },
  { value: "TREATMENT_HISTORY", label: "Treatment / Discharge Summary" },
  { value: "OTHER", label: "Other Supporting Evidence" }
];

const schema = z.object({
  claimNumber: z.string().trim().min(3, "Enter at least 3 characters.").max(40).regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers, or hyphens."),
  patientName: z.string().trim().min(2, "Enter patient name.").max(100),
  insuranceOrganizationId: z.string().min(1, "Select an insurance company payer."),
  policyNumber: z.string().trim().min(3, "Enter policy number.").max(50),
  diagnosisCode: z.string().trim().min(2, "Enter diagnosis ICD code.").max(50),
  procedureCode: z.string().trim().min(2, "Enter procedure CPT/PCS code.").max(50),
  treatmentDescription: z.string().trim().min(5, "Enter treatment description.").max(2000),
  serviceDate: z.string().min(1, "Choose a service date."),
  amount: z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, "Enter an amount with up to two decimal places.")
});

const DEFAULT_INSURERS = [
  { id: "org-ins-01", name: "Bharat Health Assurance", type: "INSURANCE_COMPANY" },
  { id: "org-ins-02", name: "Aarogya General Insurance", type: "INSURANCE_COMPANY" }
];

const emptyForm = {
  claimNumber: "",
  patientName: "",
  insuranceOrganizationId: "org-ins-01",
  policyNumber: "",
  diagnosisCode: "",
  procedureCode: "",
  treatmentDescription: "",
  serviceDate: new Date().toISOString().split("T")[0],
  amount: "",
  documentType: "CLINICAL_NOTE"
};

const STATUS_OPTIONS = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "DENIED",
  "APPEAL_DRAFT",
  "SUBMITTED_FOR_REVIEW",
  "PAID",
  "CLOSED"
];

const NON_MEDICAL_PATTERNS = [
  "resume", "curriculum_vitae", "curriculum vitae", "cv.pdf", "cv.docx",
  "bank_statement", "bank statement", "passbook", "salary_slip", "salary slip",
  "electricity_bill", "electricity bill", "power_bill", "water_bill",
  "rental_agreement", "lease_agreement", "movie_ticket", "boarding_pass", "flight_ticket"
];

function validateDocumentFile(file) {
  if (!file) {
    return "Please choose a medical document (PDF or DOCX).";
  }
  if (file.size === 0) {
    return "The uploaded document is empty or contains no readable text. Please upload a valid medical document.";
  }
  if (file.size > 20 * 1024 * 1024) {
    return "Document exceeds the 20MB upload size limit. Please upload a smaller file.";
  }
  const fname = (file.name || "").toLowerCase();
  if (!fname.endsWith(".pdf") && !fname.endsWith(".docx")) {
    return "Invalid Document! The uploaded file does not appear to be a medical or healthcare-related document. Please upload a valid medical document.";
  }
  for (const nmp of NON_MEDICAL_PATTERNS) {
    if (fname.includes(nmp)) {
      return "Invalid Document! The uploaded file does not appear to be a medical or healthcare-related document. Please upload a valid medical document.";
    }
  }
  return null;
}

export function ClaimsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isReviewer, isBillingSpecialist } = useAuth();
  const { showToast, notify } = useToast();
  const toastMsg = showToast || notify;
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const [insuranceOrgs, setInsuranceOrgs] = useState(DEFAULT_INSURERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1");
  const [form, setForm] = useState(emptyForm);
  const [docEntries, setDocEntries] = useState([
    { id: "entry-1", file: null, type: "CLINICAL_NOTE" }
  ]);
  const [docErrors, setDocErrors] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  function addDocumentEntry() {
    setDocEntries((prev) => [
      ...prev,
      { id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`, file: null, type: "CLINICAL_NOTE" }
    ]);
  }

  function removeDocumentEntry(id) {
    setDocErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setDocEntries((prev) => {
      if (prev.length <= 1) {
        return [{ id: "entry-1", file: null, type: "CLINICAL_NOTE" }];
      }
      return prev.filter((d) => d.id !== id);
    });
  }

  function updateDocumentEntry(id, patch) {
    if ("file" in patch) {
      const err = patch.file ? validateDocumentFile(patch.file) : null;
      setDocErrors((prev) => {
        const next = { ...prev };
        if (err) next[id] = err;
        else delete next[id];
        return next;
      });
      if (err) {
        setFieldErrors((prev) => ({ ...prev, file: undefined }));
      }
    }
    setDocEntries((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  // Reviewer cannot create claims; billing specialists and admins can
  const canCreate = ["PROVIDER", "BILLING_SPECIALIST", "ADMIN"].includes(user?.role);

  // Load insurance organizations for dropdown
  useEffect(() => {
    api.organizations({ type: "INSURANCE_COMPANY" })
      .then((res) => {
        let orgs = [];
        if (Array.isArray(res)) orgs = res;
        else if (Array.isArray(res?.data)) orgs = res.data;
        else if (Array.isArray(res?.data?.data)) orgs = res.data.data;

        if (orgs.length > 0) {
          setInsuranceOrgs(orgs);
          const defaultIns = orgs.find((o) => o.id === "org-ins-01") || orgs[0];
          setForm((prev) => prev.insuranceOrganizationId ? prev : ({ ...prev, insuranceOrganizationId: defaultIns.id }));
        }
      })
      .catch((err) => {
        console.error("Failed to load insurance organizations", err);
      });
  }, []);

  const load = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError("");
    try {
      setResult(await api.claims({ page, limit: 10, search, status }));
    } catch (failure) {
      if (!isSilent) setError(failure.message);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [page, search, status, revision]);

  useEffect(() => {
    load(false);
  }, [load]);

  // Dynamic cross-tab sync and 3-second live polling
  useClaimSync(() => {
    if (!showForm) load(true);
  }, 3000);
  useEffect(() => { if (searchParams.get("new") === "1") setShowForm(true); }, [searchParams]);

  function submitSearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function closeForm() {
    setShowForm(false);
    setForm({
      ...emptyForm,
      insuranceOrganizationId: insuranceOrgs.find((o) => o.id === "org-ins-01")?.id || insuranceOrgs[0]?.id || "org-ins-01"
    });
    setDocEntries([{ id: "entry-1", file: null, type: "CLINICAL_NOTE" }]);
    setDocErrors({});
    setFieldErrors({});
    setFormError("");
    if (searchParams.has("new")) setSearchParams({});
  }

  async function createClaim(event) {
    event.preventDefault();
    setFormError("");

    const parsed = schema.safeParse(form);
    const validDocs = docEntries.filter((d) => d.file != null);

    if (!parsed.success) {
      const errMap = Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message]));
      if (validDocs.length === 0) {
        errMap.file = "At least one supporting clinical document (PDF/DOCX) is required.";
      }
      setFieldErrors(errMap);
      return;
    }

    if (validDocs.length === 0) {
      setFieldErrors({ file: "Please select at least one supporting clinical document (PDF/DOCX)." });
      return;
    }

    // Pre-validate all attached documents (valid medical format, non-empty, allowed size)
    // Note: Duplicate files or files used for another claim are fully supported and accepted
    const initialDocErrors = {};
    for (const doc of validDocs) {
      const err = validateDocumentFile(doc.file);
      if (err) {
        initialDocErrors[doc.id] = err;
      }
    }
    if (Object.keys(initialDocErrors).length > 0) {
      setDocErrors(initialDocErrors);
      setFormError("One or more attached documents failed validation. Please upload valid medical PDF or DOCX documents.");
      return;
    }

    setFieldErrors({});
    setSaving(true);
    try {
      // 1. Create or update claim (idempotent submission supported)
      const claim = await api.createClaim({
        claimNumber: parsed.data.claimNumber,
        patientName: parsed.data.patientName,
        insuranceOrganizationId: parsed.data.insuranceOrganizationId,
        policyNumber: parsed.data.policyNumber,
        diagnosisCode: parsed.data.diagnosisCode,
        procedureCode: parsed.data.procedureCode,
        treatmentDescription: parsed.data.treatmentDescription,
        serviceDate: new Date(parsed.data.serviceDate + "T12:00:00.000Z").toISOString(),
        amount: parsed.data.amount,
        currency: "INR"
      });

      // 2. Upload supporting documents sequentially
      let successfulUploadCount = 0;
      const uploadFailures = [];
      const runtimeDocErrors = {};

      for (const doc of validDocs) {
        try {
          await api.uploadDocument(claim.id, {
            file: doc.file,
            type: doc.type || "CLINICAL_NOTE",
            sourceDate: parsed.data.serviceDate
          });
          successfulUploadCount++;
        } catch (uploadErr) {
          const errMsg = uploadErr.message || "Upload failed";
          uploadFailures.push(`${doc.file?.name || "Document"}: ${errMsg}`);
          runtimeDocErrors[doc.id] = errMsg;
          console.warn("Document indexing deferred for file " + (doc.file?.name || "") + ":", uploadErr);
        }
      }

      if (uploadFailures.length > 0 && successfulUploadCount === 0) {
        setDocErrors(runtimeDocErrors);
        setFormError(uploadFailures.join(" | "));
        setSaving(false);
        return;
      }

      if (toastMsg) {
        const docMsg = successfulUploadCount > 0
          ? `${successfulUploadCount} document${successfulUploadCount > 1 ? "s" : ""} attached.`
          : "";
        toastMsg(
          `Claim ${claim.claimNumber} submitted to ${claim.payerName || "insurance"} review queue. ${docMsg}`,
          { type: "success" }
        );
      }
      broadcastClaimUpdate("CLAIM_CREATED", { claimId: claim.id });
      closeForm();
      navigate("/claims/" + encodeURIComponent(claim.id));
    } catch (failure) {
      setFormError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Hospital-to-Payer Workflow"
        title="Claims Management"
        description="Submit and manage hospital service claims routed directly to insurance compliance review queues."
        actions={canCreate ? <Button icon={Plus} onClick={() => { setShowForm(true); setSearchParams({ new: "1" }); }}>New Claim</Button> : null}
      />

      {showForm && canCreate && (
        <Card className="mb-6 p-4 sm:p-5 border-teal-200 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Submit New Hospital Service Claim</h2>
              <p className="mt-1 text-xs text-slate-500">
                Claim will be validated, linked to your hospital, and automatically routed to the selected insurance company review queue.
              </p>
            </div>
            <Button variant="ghost" size="sm" icon={X} aria-label="Close form" onClick={closeForm}>
              Close
            </Button>
          </div>

          <form onSubmit={createClaim} noValidate>
            {formError && (
              <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {formError}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label="Claim Number"
                name="claimNumber"
                placeholder="e.g. CLM-IND-2026-09"
                value={form.claimNumber}
                error={fieldErrors.claimNumber}
                onChange={(e) => setForm({ ...form, claimNumber: e.target.value })}
              />

              <Field
                label="Patient Full Name"
                name="patientName"
                placeholder="e.g. Vikram Malhotra"
                value={form.patientName}
                error={fieldErrors.patientName}
                onChange={(e) => setForm({ ...form, patientName: e.target.value })}
              />

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Hospital Facility
                </label>
                <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700">
                  <Building2 size={14} className="mr-2 text-teal-600" />
                  {user?.organization?.name || "Sri Venkateswara Multispeciality Hospital"}
                </div>
              </div>

              <SelectField
                label="Insurance Company (Payer)"
                name="insuranceOrganizationId"
                value={form.insuranceOrganizationId}
                error={fieldErrors.insuranceOrganizationId}
                onChange={(e) => setForm({ ...form, insuranceOrganizationId: e.target.value })}
              >
                <option value="">Select Insurance Provider...</option>
                {insuranceOrgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </SelectField>

              <Field
                label="Insurance Policy Number"
                name="policyNumber"
                placeholder="e.g. BHA-MED-782190"
                value={form.policyNumber}
                error={fieldErrors.policyNumber}
                onChange={(e) => setForm({ ...form, policyNumber: e.target.value })}
              />

              <Field
                label="Service / Admission Date"
                name="serviceDate"
                type="date"
                value={form.serviceDate}
                error={fieldErrors.serviceDate}
                onChange={(e) => setForm({ ...form, serviceDate: e.target.value })}
              />

              <Field
                label="Diagnosis Code (ICD-10)"
                name="diagnosisCode"
                placeholder="e.g. I21.9 or K80.00"
                value={form.diagnosisCode}
                error={fieldErrors.diagnosisCode}
                onChange={(e) => setForm({ ...form, diagnosisCode: e.target.value })}
              />

              <Field
                label="Procedure Code (CPT / PCS)"
                name="procedureCode"
                placeholder="e.g. 02703ZZ or 47562"
                value={form.procedureCode}
                error={fieldErrors.procedureCode}
                onChange={(e) => setForm({ ...form, procedureCode: e.target.value })}
              />

              <Field
                label="Claim Amount (₹ INR)"
                name="amount"
                inputMode="decimal"
                placeholder="125000.00"
                value={form.amount}
                error={fieldErrors.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Treatment Description & Clinical Summary
              </label>
              <textarea
                name="treatmentDescription"
                rows={2}
                placeholder="e.g. Acute myocardial infarction requiring emergent coronary catheterization and drug-eluting stent placement."
                className="w-full rounded-md border border-slate-200 bg-white p-2.5 text-xs text-slate-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={form.treatmentDescription}
                onChange={(e) => setForm({ ...form, treatmentDescription: e.target.value })}
              />
              {fieldErrors.treatmentDescription && (
                <p className="mt-1 text-[11px] text-red-600">{fieldErrors.treatmentDescription}</p>
              )}
            </div>

            {/* Supporting Clinical Documents with Dynamic + Icon to Add Another Document */}
            <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-teal-100">
                <div className="flex items-center gap-2">
                  <Upload size={16} className="text-teal-700" />
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Supporting Clinical Documents *</h3>
                    <p className="text-[11px] text-slate-500">
                      Upload operative notes, lab reports, imaging, or discharge summaries (PDF/DOCX). Files can be reused across different claims or duplicated as needed.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addDocumentEntry}
                  className="inline-flex items-center gap-1.5 rounded-md border border-teal-600 bg-white px-2.5 py-1 text-xs font-semibold text-teal-700 shadow-xs hover:bg-teal-50 focus:outline-none focus:ring-1 focus:ring-teal-500 transition-colors cursor-pointer"
                  title="Upload another document"
                >
                  <Plus size={14} className="text-teal-700" />
                  <span>Upload Another Document</span>
                </button>
              </div>

              {fieldErrors.file && (
                <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {fieldErrors.file}
                </div>
              )}

              <div className="space-y-3">
                {docEntries.map((entry, index) => {
                  const hasError = Boolean(docErrors[entry.id]);
                  const isValid = Boolean(entry.file && !hasError);
                  return (
                    <div
                      key={entry.id}
                      className={`relative rounded-md border p-3 shadow-xs transition-colors ${
                        hasError
                          ? "border-red-300 bg-red-50/25"
                          : isValid
                          ? "border-teal-300 bg-white"
                          : "border-slate-200 bg-white hover:border-teal-200"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                            hasError ? "bg-red-600 text-white" : "bg-teal-100 text-teal-800"
                          }`}>
                            {index + 1}
                          </span>
                          Document #{index + 1}
                        </span>
                        {docEntries.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeDocumentEntry(entry.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors cursor-pointer"
                            title="Remove document slot"
                          >
                            <X size={13} />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <SelectField
                          label="Document Type"
                          name={`docType-${entry.id}`}
                          value={entry.type}
                          onChange={(e) => updateDocumentEntry(entry.id, { type: e.target.value })}
                        >
                          {DOCUMENT_TYPES.map((dt) => (
                            <option key={dt.value} value={dt.value}>{dt.label}</option>
                          ))}
                        </SelectField>

                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">
                            File Attachment (PDF / DOCX) *
                          </label>
                          <input
                            type="file"
                            accept=".pdf,.docx"
                            className="w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-teal-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-teal-800 cursor-pointer"
                            onChange={(e) => updateDocumentEntry(entry.id, { file: e.target.files?.[0] || null })}
                          />
                          {docErrors[entry.id] && (
                            <div role="alert" className="mt-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-700 font-medium">
                              {docErrors[entry.id]}
                            </div>
                          )}
                          {entry.file && !docErrors[entry.id] && (
                            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-800 font-medium truncate bg-emerald-50/70 border border-emerald-200 rounded px-2 py-1">
                              <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                              <span className="truncate">{entry.file.name} ({(entry.file.size / 1024).toFixed(1)} KB) &bull; Verified format</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 flex items-center justify-end pt-1">
                <span className="text-[11px] text-slate-500">
                  {docEntries.filter((d) => d.file != null).length} of {docEntries.length} file(s) attached
                </span>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={closeForm}>Cancel</Button>
              <Button type="submit" loading={saving}>{saving ? "Submitting Claim..." : "Submit to Insurance"}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden">
        <form className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4" onSubmit={submitSearch}>
          <Field
            className="min-w-[200px] flex-1"
            label="Search claims"
            name="claimSearch"
            placeholder="Search by claim number, patient, or hospital..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <SelectField
            className="w-full sm:w-44"
            label="Status"
            name="claimStatus"
            value={status}
            onChange={(e) => { setPage(1); setStatus(e.target.value); }}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((val) => (
              <option key={val} value={val}>
                {val.toLowerCase().replaceAll("_", " ")}
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="outline" icon={Search}>Search</Button>
          {(search || status) && (
            <Button
              type="button"
              variant="ghost"
              icon={X}
              onClick={() => { setSearchInput(""); setSearch(""); setStatus(""); setPage(1); }}
            >
              Clear
            </Button>
          )}
        </form>

        {loading && !result ? (
          <div className="p-4"><LoadingState label="Loading claims" /></div>
        ) : error && !result ? (
          <div className="p-4"><ErrorState message={error} onRetry={() => setRevision((v) => v + 1)} /></div>
        ) : (result?.data?.length || 0) === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No claims found"
            description={search || status ? "Try clearing a filter or changing search terms." : "Claims authorized for your facility will appear here."}
            action={canCreate && <Button size="sm" icon={Plus} onClick={() => setShowForm(true)}>Submit a Claim</Button>}
          />
        ) : (
          <>
            {error && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">Refresh failed: {error}</div>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[950px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Claim Number</th>
                    <th className="px-4 py-3">Patient Name</th>
                    <th className="px-4 py-3">Hospital</th>
                    <th className="px-4 py-3">Insurance</th>
                    <th className="px-4 py-3">Policy No</th>
                    <th className="px-4 py-3">Service Date</th>
                    <th className="px-4 py-3 text-right">Amount (₹)</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.data.map((claim) => (
                    <tr key={claim.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-semibold">
                        <Link className="text-teal-800 hover:underline" to={"/claims/" + claim.id}>
                          {claim.claimNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">{claim.patientName || "—"}</td>
                      <td className="px-4 py-3 text-slate-600 truncate max-w-[200px]">
                        {claim.hospitalOrganization?.name || claim.hospitalName || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {claim.insuranceOrganization?.name || claim.payerName || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">{claim.policyNumber || "—"}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(claim.serviceDate)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                        {formatCurrency(claim.amount, claim.currency)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={claim.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isBillingSpecialist && claim.status === "DENIED" ? (
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              className="inline-flex items-center gap-1 rounded bg-red-50 px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100 hover:text-red-800 transition"
                              to={`/denials?selected=${claim.denials?.[0]?.id || ""}&claim=${claim.id}`}
                              title="Analyse this denial with AI"
                            >
                              <Sparkles size={12} className="text-red-600" />
                              Analyse Denial
                            </Link>
                            <Link className="font-semibold text-slate-500 hover:text-slate-800" to={"/claims/" + claim.id}>
                              View Claim &rarr;
                            </Link>
                          </div>
                        ) : (
                          <Link className="font-semibold text-teal-800 hover:underline" to={"/claims/" + claim.id}>
                            View Claim &rarr;
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination pagination={result.pagination} onChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
