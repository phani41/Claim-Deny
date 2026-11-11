import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { 
  ShieldCheck, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  FileText, 
  Building2, 
  FileWarning, 
  ArrowRight,
  RotateCcw,
  Sparkles,
  ClipboardList,
  FileCheck2
} from "lucide-react";
import { api } from "../api/client.js";
import { useAuth } from "../context/auth-context.jsx";
import { Button, Card, StatCard, StatusBadge } from "../components/ui.jsx";
import { formatCurrency, formatDate } from "../lib/format.js";

export function ReviewerDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState(null);
  const [claims, setClaims] = useState([]);
  const [letters, setLetters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setIsRefreshing(true);
    setError("");
    try {
      const [statsRes, claimsRes, lettersRes] = await Promise.all([
        api.dashboardStats(),
        api.claims({ page: 1, limit: 50 }),
        api.appealLetters({ page: 1, limit: 50 })
      ]);
      setStats(statsRes);
      setClaims(claimsRes?.data || []);
      setLetters(lettersRes?.data || []);
    } catch (err) {
      if (!isSilent) setError(err.message || "Failed to load reviewer dashboard");
    } finally {
      if (!isSilent) setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData(false);

    // Live auto-refresh polling every 4 seconds
    const pollInterval = setInterval(() => {
      loadData(true);
    }, 4000);

    const onFocus = () => loadData(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") loadData(true);
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadData]);

  // Deduplicated unique lists
  const deduplicatedClaims = useMemo(() => {
    const map = new Map();
    for (const c of claims) {
      const key = c.claimNumber || c.id;
      if (!map.has(key)) map.set(key, c);
    }
    return Array.from(map.values());
  }, [claims]);

  const deduplicatedLetters = useMemo(() => {
    const map = new Map();
    for (const l of letters) {
      const key = l.claimId || l.id;
      if (!map.has(key)) map.set(key, l);
    }
    return Array.from(map.values());
  }, [letters]);

  // Claims awaiting initial reviewer decision
  const pendingClaims = useMemo(() => {
    return deduplicatedClaims.filter((c) => ["SUBMITTED", "UNDER_REVIEW"].includes(c.status));
  }, [deduplicatedClaims]);

  // Appeals awaiting final compliance review
  const pendingAppeals = useMemo(() => {
    return deduplicatedLetters.filter((l) => ["SUBMITTED_FOR_REVIEW", "IN_REVIEW", "SUBMITTED"].includes(l.status));
  }, [deduplicatedLetters]);

  // Recently finalized decisions (Approved or Denied/Rejected)
  const recentDecisions = useMemo(() => {
    const list = [];
    claims
      .filter((c) => ["APPROVED", "DENIED"].includes(c.status))
      .forEach((c) => {
        list.push({
          id: c.id,
          type: "Claim",
          number: c.claimNumber,
          patient: c.patientName,
          amount: c.amount,
          currency: c.currency,
          status: c.status,
          date: c.updatedAt || c.serviceDate,
          targetUrl: `/appeals/review?tab=claims&claim=${encodeURIComponent(c.id)}`
        });
      });

    letters
      .filter((l) => ["APPROVED", "REJECTED"].includes(l.status))
      .forEach((l) => {
        list.push({
          id: l.id,
          type: "Appeal",
          number: l.claim?.claimNumber || l.subject,
          patient: l.claim?.patientName,
          amount: l.claim?.amount,
          currency: l.claim?.currency,
          status: l.status,
          date: l.reviewedAt || l.updatedAt,
          targetUrl: `/appeals/review?tab=appeals&letter=${encodeURIComponent(l.id)}`
        });
      });

    return list.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
  }, [claims, letters]);

  if (loading && !stats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  const organizationName = user?.organization?.name || "Bharat Health Assurance";

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-indigo-100 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
              Insurance Review Desk
            </span>
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Building2 size={13} className="text-indigo-600" />
              {organizationName}
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Welcome, {user?.displayName}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Adjudicate submitted hospital claims, inspect clinical evidence, and certify appeal letters.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={RotateCcw}
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            title="Refresh dashboard"
          >
            Refresh
          </Button>
          <Button
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-2xs"
            icon={ShieldCheck}
            onClick={() => navigate("/appeals/review")}
          >
            Open Review Queue &rarr;
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {error}
        </div>
      )}

      {/* Summary Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Clock}
          label="Claims Pending Review"
          value={pendingClaims.length}
          tone="amber"
        />
        <StatCard
          icon={FileCheck2}
          label="Appeals in Review"
          value={pendingAppeals.length}
          tone="blue"
        />
        <StatCard
          icon={CheckCircle2}
          label="Approved Decisions"
          value={stats?.approvedClaims ?? 0}
          tone="green"
        />
        <StatCard
          icon={XCircle}
          label="Denied Claims"
          value={stats?.deniedClaims ?? 0}
          tone="slate"
        />
      </div>

      {/* Main Review Queues Overview (Side-by-Side) */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Claims Pending Initial Decision */}
        <Card className="p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <ClipboardList size={16} className="text-indigo-600" />
              <h2 className="text-sm font-bold text-slate-900">
                Claims Awaiting Decision ({pendingClaims.length})
              </h2>
            </div>
            <Link
              to="/appeals/review?tab=claims"
              className="text-xs font-semibold text-indigo-700 hover:underline flex items-center gap-1"
            >
              Open Claims Queue &rarr;
            </Link>
          </div>

          <div className="mt-3 divide-y divide-slate-100 text-xs">
            {pendingClaims.length === 0 ? (
              <div className="py-8 text-center text-slate-400">
                <CheckCircle2 size={24} className="mx-auto text-emerald-500 mb-1.5 opacity-80" />
                <p className="font-semibold text-slate-700">No claims pending review</p>
                <p className="text-[11px] text-slate-400 mt-0.5">All submitted claims have been adjudicated.</p>
              </div>
            ) : (
              pendingClaims.slice(0, 5).map((claim) => (
                <div key={claim.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{claim.claimNumber}</span>
                      <StatusBadge status={claim.status} />
                    </div>
                    <div className="mt-0.5 truncate text-slate-600">
                      {claim.patientName || "Patient"} &bull; {claim.hospitalOrganization?.name || claim.hospitalName}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      Amount: <span className="font-semibold text-slate-700">{formatCurrency(claim.amount, claim.currency)}</span> &bull; Service: {formatDate(claim.serviceDate)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium shrink-0"
                    onClick={() => navigate(`/appeals/review?tab=claims&claim=${encodeURIComponent(claim.id)}`)}
                  >
                    Adjudicate &rarr;
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Appeals Awaiting Final Compliance Decision */}
        <Card className="p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-teal-700" />
              <h2 className="text-sm font-bold text-slate-900">
                Appeals Awaiting Review ({pendingAppeals.length})
              </h2>
            </div>
            <Link
              to="/appeals/review?tab=appeals"
              className="text-xs font-semibold text-teal-700 hover:underline flex items-center gap-1"
            >
              Open Appeals Queue &rarr;
            </Link>
          </div>

          <div className="mt-3 divide-y divide-slate-100 text-xs">
            {pendingAppeals.length === 0 ? (
              <div className="py-8 text-center text-slate-400">
                <CheckCircle2 size={24} className="mx-auto text-teal-500 mb-1.5 opacity-80" />
                <p className="font-semibold text-slate-700">No appeals awaiting review</p>
                <p className="text-[11px] text-slate-400 mt-0.5">All hospital appeal letters have been processed.</p>
              </div>
            ) : (
              pendingAppeals.slice(0, 5).map((letter) => (
                <div key={letter.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">Claim {letter.claim?.claimNumber}</span>
                      <StatusBadge status={letter.status} />
                      <span className="text-[10px] text-slate-400">Rev #{letter.revisionNumber || 1}</span>
                    </div>
                    <div className="mt-0.5 truncate text-slate-600">
                      {letter.claim?.patientName || "Patient"} &bull; {letter.subject}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      Submitted: {formatDate(letter.submittedAt || letter.updatedAt)} &bull; Citations: {letter.citations?.length || 0}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-teal-700 hover:bg-teal-800 text-white font-medium shrink-0"
                    onClick={() => navigate(`/appeals/review?tab=appeals&letter=${encodeURIComponent(letter.id)}`)}
                  >
                    Review Appeal &rarr;
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Recently Finalized Decisions (Audit Trail) */}
      <Card className="p-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-700" />
            <h2 className="text-sm font-bold text-slate-900">Recent Adjudication Decisions</h2>
          </div>
          <Link
            to="/claims"
            className="text-xs font-semibold text-indigo-700 hover:underline"
          >
            All Claims Directory &rarr;
          </Link>
        </div>

        <div className="mt-3 overflow-x-auto">
          {recentDecisions.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No finalized decisions yet.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="pb-2 font-semibold">Type</th>
                  <th className="pb-2 font-semibold">Claim # / Title</th>
                  <th className="pb-2 font-semibold">Patient</th>
                  <th className="pb-2 font-semibold text-right">Amount (₹)</th>
                  <th className="pb-2 font-semibold text-center">Outcome</th>
                  <th className="pb-2 font-semibold">Decision Date</th>
                  <th className="pb-2 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {recentDecisions.map((item) => (
                  <tr key={`${item.type}-${item.id}`} className="hover:bg-slate-50/70">
                    <td className="py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        item.type === "Appeal" ? "bg-teal-50 text-teal-800" : "bg-indigo-50 text-indigo-800"
                      }`}>
                        {item.type}
                      </span>
                    </td>
                    <td className="py-2.5 font-bold text-slate-900">{item.number}</td>
                    <td className="py-2.5 font-medium text-slate-800">{item.patient || "—"}</td>
                    <td className="py-2.5 text-right font-semibold text-slate-900">
                      {formatCurrency(item.amount, item.currency)}
                    </td>
                    <td className="py-2.5 text-center">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="py-2.5 text-slate-500">{formatDate(item.date)}</td>
                    <td className="py-2.5 text-right">
                      <Link
                        to={item.targetUrl}
                        className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline"
                      >
                        Inspect <ArrowRight size={12} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
