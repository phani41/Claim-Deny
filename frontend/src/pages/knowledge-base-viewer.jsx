import { useCallback, useEffect, useState } from "react";
import { 
  BookOpen, 
  Search, 
  FileText, 
  Building2, 
  CheckCircle2, 
  X,
  Layers,
  Shield,
  HelpCircle
} from "lucide-react";
import { api } from "../api/client.js";
import { Button, Card, EmptyState, Modal, PageHeader, StatCard } from "../components/ui.jsx";
import { formatDate } from "../lib/format.js";

const CATEGORY_LABELS = {
  INSURANCE_POLICY: "Insurance Policy & Wording",
  CLAIM_GUIDELINE: "Claim Submission & Billing",
  DENIAL_GUIDELINE: "Denial Codes & Rejection Protocols",
  MEDICAL_GUIDELINE: "Medical Coding & Clinical Necessity",
  APPEAL_GUIDELINE: "Appeal & Reconsideration Guidelines"
};

export function KnowledgeBaseViewerPage() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [inspectingDoc, setInspectingDoc] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.knowledgeDocuments();
      setDocs(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredDocs = docs.filter((doc) => {
    const matchesCat = !categoryFilter || doc.category === categoryFilter;
    const matchesSearch = !search || 
      doc.title.toLowerCase().includes(search.toLowerCase()) ||
      doc.fileName.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clinical & Policy Library"
        title="Knowledge Base & Guidelines"
        description="Browse healthcare insurance policy wordings, medical necessity criteria, ICD-10 coding guidelines, and appeal procedure protocols indexed in the AI system."
      />

      {/* Search & Filter Bar */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search guidelines, policies, or denial references..."
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
              <option value="">All Reference Documents</option>
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

      {/* Grid of Knowledge Cards */}
      {loading ? (
        <div className="py-12 text-center">
          <div className="mx-auto size-7 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
          <p className="mt-2 text-xs text-slate-500">Loading reference library...</p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <Card>
          <EmptyState
            icon={BookOpen}
            title="No documents found"
            description="Try changing your search terms or selecting a different category."
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredDocs.map((doc) => (
            <Card key={doc.id} className="flex flex-col justify-between p-4 hover:shadow-md transition">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="rounded bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-700">
                    {CATEGORY_LABELS[doc.category] || doc.category}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 font-medium">
                    <CheckCircle2 size={11} /> Indexed
                  </span>
                </div>
                <h3 className="text-xs font-bold text-slate-900 leading-snug">{doc.title}</h3>
                <p className="mt-1 font-mono text-[10px] text-slate-400">{doc.fileName}</p>
                {doc.organization && (
                  <p className="mt-2 flex items-center gap-1 text-[11px] text-indigo-700 font-medium">
                    <Building2 size={12} /> {doc.organization.name}
                  </p>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[10px] text-slate-400">{doc.scope}</span>
                <Button size="sm" variant="secondary" onClick={() => setInspectingDoc(doc)}>
                  Read Summary
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal */}
      {inspectingDoc && (
        <Modal
          open={true}
          title={inspectingDoc.title}
          onClose={() => setInspectingDoc(null)}
        >
          <div className="space-y-3 text-xs">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800">{inspectingDoc.fileName}</span>
                <span className="rounded bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-800">
                  {CATEGORY_LABELS[inspectingDoc.category]}
                </span>
              </div>
              <p className="text-slate-500">
                Scope: <strong>{inspectingDoc.scope}</strong> {inspectingDoc.organization ? `• Insurer: ${inspectingDoc.organization.name}` : "• Global Reference"}
              </p>
            </div>

            <div className="rounded-lg border border-teal-100 bg-teal-50/50 p-3 text-slate-700 leading-relaxed">
              <h4 className="font-bold text-teal-900 mb-1">AI Clinical Integration Context</h4>
              <p className="text-[11px]">
                This document is indexed in the clinical knowledge base. During AI denial analysis and appeal generation, this document is automatically cited and referenced by Ollama AI when the claim involves relevant denial codes, diagnosis categories, or policy clauses.
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
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

