import { useCallback, useEffect, useState } from "react";
import { 
  BookOpen, 
  RotateCw, 
  Search, 
  Shield, 
  FileText, 
  Building2, 
  CheckCircle2, 
  Clock, 
  X,
  ExternalLink,
  Layers
} from "lucide-react";
import { api } from "../api/client.js";
import { Button, Card, EmptyState, Modal, PageHeader, StatCard, StatusBadge } from "../components/ui.jsx";
import { useToast } from "../context/toast-context.jsx";
import { formatDate } from "../lib/format.js";

const CATEGORY_LABELS = {
  INSURANCE_POLICY: "Insurance Policy & Wording",
  CLAIM_GUIDELINE: "Claim Submission & Billing",
  DENIAL_GUIDELINE: "Denial Codes & Rejection Protocols",
  MEDICAL_GUIDELINE: "Medical Coding & Clinical Necessity",
  APPEAL_GUIDELINE: "Appeal & Reconsideration Guidelines"
};

export function AdminKnowledgeBasePage() {
  const { showToast, notify } = useToast();
  const toast = showToast || notify;

  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [inspectingDoc, setInspectingDoc] = useState(null);
  const [reindexingId, setReindexingId] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.adminKnowledgeDocuments();
      setDocs(res.data || []);
    } catch (err) {
      setError(err.message || "Failed to load knowledge base records.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleReindex(doc) {
    setReindexingId(doc.id);
    try {
      await api.reindexKnowledgeDocument(doc.id);
      if (toast) toast(`Document "${doc.title.slice(0, 30)}..." reindexed successfully.`, { type: "success" });
      loadData();
    } catch (err) {
      if (toast) toast(err.message || "Failed to reindex document.", { type: "error" });
    } finally {
      setReindexingId("");
    }
  }

  const filteredDocs = docs.filter((doc) => {
    const matchesCat = !categoryFilter || doc.category === categoryFilter;
    const matchesSearch = !search || 
      doc.title.toLowerCase().includes(search.toLowerCase()) ||
      doc.fileName.toLowerCase().includes(search.toLowerCase()) ||
      (doc.organization?.name || "").toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const totalPolicies = docs.filter((d) => d.category === "INSURANCE_POLICY").length;
  const totalGuidelines = docs.filter((d) => d.category.includes("GUIDELINE")).length;
  const totalIndexed = docs.filter((d) => d.indexingStatus === "INDEXED").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clinical Knowledge Governance"
        title="Knowledge Base Management"
        description="Inspect and govern official policies and clinical guidelines used by Ollama AI during denial analysis and appeal generation."
        actions={
          <Button variant="outline" icon={RotateCw} onClick={loadData}>
            Refresh Index
          </Button>
        }
      />

      {/* Summary Counters */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={BookOpen}
          label="Total Documents"
          value={docs.length}
        />
        <StatCard
          icon={CheckCircle2}
          label="Active Indexed"
          value={totalIndexed}
          tone="green"
        />
        <StatCard
          icon={Building2}
          label="Insurer Policies"
          value={totalPolicies}
          tone="blue"
        />
        <StatCard
          icon={Layers}
          label="Clinical Guides"
          value={totalGuidelines}
          tone="amber"
        />
      </div>

      {/* Search & Filter Bar */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by title, file name, or organization..."
              className="w-full rounded-md border border-slate-200 pl-9 pr-3 py-1.5 text-xs text-slate-800 outline-none focus:border-teal-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-teal-500"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              <option value="INSURANCE_POLICY">Insurance Policies</option>
              <option value="CLAIM_GUIDELINE">Claim Submission & Billing</option>
              <option value="DENIAL_GUIDELINE">Denial Guidelines & Codes</option>
              <option value="MEDICAL_GUIDELINE">Medical & Clinical Guidelines</option>
              <option value="APPEAL_GUIDELINE">Appeal Guidelines</option>
            </select>

            {(search || categoryFilter) && (
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                onClick={() => { setSearch(""); setCategoryFilter(""); }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Documents Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-12 text-center">
            <div className="mx-auto size-7 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
            <p className="mt-2 text-xs text-slate-500">Loading knowledge base records...</p>
          </div>
        ) : filteredDocs.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No knowledge documents found"
            description="Try changing your search keywords or category filter."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Document Title</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Target Scope</th>
                  <th className="px-4 py-3 font-semibold">Organization</th>
                  <th className="px-4 py-3 font-semibold text-center">Status</th>
                  <th className="px-4 py-3 font-semibold">Last Indexed</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredDocs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 max-w-xs">
                      <div className="font-semibold text-slate-900">{doc.title}</div>
                      <div className="font-mono text-[10px] text-slate-400">{doc.fileName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                        {CATEGORY_LABELS[doc.category] || doc.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                        doc.scope === "INSURANCE_POLICY_SCOPE" 
                          ? "bg-indigo-50 text-indigo-700" 
                          : "bg-teal-50 text-teal-700"
                      }`}>
                        {doc.scope}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {doc.organization ? (
                        <div className="flex items-center gap-1.5">
                          <Building2 size={13} className="text-indigo-600" />
                          <span>{doc.organization.name}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Shared Reference</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        <CheckCircle2 size={11} /> {doc.indexingStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                      {doc.indexedAt ? formatDate(doc.indexedAt) : "Just now"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setInspectingDoc(doc)}
                        >
                          Inspect
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          icon={RotateCw}
                          loading={reindexingId === doc.id}
                          onClick={() => handleReindex(doc)}
                        >
                          Reindex
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Document Inspection Modal */}
      {inspectingDoc && (
        <Modal
          open={true}
          title={inspectingDoc.title}
          onClose={() => setInspectingDoc(null)}
        >
          <div className="space-y-4 text-xs">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">File Name</span>
                  <p className="font-mono text-slate-800">{inspectingDoc.fileName}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Category</span>
                  <p className="font-semibold text-slate-800">{CATEGORY_LABELS[inspectingDoc.category] || inspectingDoc.category}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Retrieval Scope</span>
                  <p className="font-bold text-teal-800">{inspectingDoc.scope}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Target Organization</span>
                  <p className="font-semibold text-slate-800">{inspectingDoc.organization?.name || "Global / Shared"}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Vector Status</span>
                  <p className="font-bold text-emerald-700">{inspectingDoc.indexingStatus}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">File Size</span>
                  <p className="text-slate-800">{inspectingDoc.fileSize ? `${(inspectingDoc.fileSize / 1024).toFixed(1)} KB` : "4.5 KB"}</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-teal-100 bg-teal-50/40 p-3">
              <h4 className="font-bold text-teal-900 mb-1 flex items-center gap-1.5">
                <Shield size={14} className="text-teal-700" />
                RAG Multi-Tenant Access Control
              </h4>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {inspectingDoc.scope === "INSURANCE_POLICY_SCOPE" ? (
                  <>
                    This document is restricted to <strong>{inspectingDoc.organization?.name || "the designated insurer"}</strong>.
                    When a claim denied by this insurer undergoes AI analysis, RAG retrieves this document. Other insurers and hospitals cannot access it.
                  </>
                ) : (
                  <>
                    This document belongs to <strong>SHARED_REFERENCE_SCOPE</strong>.
                    It provides objective medical necessity guidelines, ICD coding standards, and appeal procedural protocols to ground AI generated letters.
                  </>
                )}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="outline" onClick={() => setInspectingDoc(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

