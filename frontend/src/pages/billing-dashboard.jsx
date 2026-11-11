import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { 
  ClipboardCheck, 
  FileWarning, 
  FileClock, 
  ArrowRight, 
  Plus, 
  Sparkles,
  RotateCcw,
  Send,
  Building2,
  CheckCircle2
} from "lucide-react";
import { api } from "../api/client.js";
import { useAuth } from "../context/auth-context.jsx";
import { Button, Card, StatCard, StatusBadge } from "../components/ui.jsx";
import { formatCurrency, formatDate } from "../lib/format.js";
import { useClaimSync } from "../lib/sync.js";

export function BillingDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [claims, setClaims] = useState([]);
  const [denials, setDenials] = useState([]);
  const [letters, setLetters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError("");
    try {
      const [statsRes, claimsRes, denialsRes, lettersRes] = await Promise.all([
        api.dashboardStats(),
        api.claims({ page: 1, limit: 10 }),
        api.denials({ page: 1, limit: 10 }),
        api.appealLetters({ page: 1, limit: 20 })
      ]);
      setStats(statsRes);
      setClaims(claimsRes?.data || []);
      setDenials((denialsRes?.data || []).filter((d) => d.status !== "RESOLVED" && d.status !== "CLOSED" && d.claim?.status !== "APPROVED"));
      setLetters(lettersRes?.data || []);
    } catch (err) {
      if (!isSilent) {
        setError(err.message || "Failed to load dashboard data");
      }
    } finally {
      if (!isSilent) setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  // Live auto-refresh polling every 3 seconds + cross-tab sync
  useClaimSync(() => {
    loadData(true);
  }, 3000);

  // Display only the latest appeal letter revision per claim on the dashboard
  const displayLetters = useMemo(() => {
    const map = new Map();
    for (const letter of letters) {
      const cid = letter.claimId;
      if (!map.has(cid)) {
        map.set(cid, letter);
      } else {
        const existing = map.get(cid);
        const existingRev = existing.revisionNumber || 1;
        const currentRev = letter.revisionNumber || 1;
        if (currentRev > existingRev) {
          map.set(cid, letter);
        }
      }
    }
    return Array.from(map.values());
  }, [letters]);

  if (loading && !stats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
      </div>
    );
  }

  const hospitalName = user?.organization?.name || "Hospital Healthcare Provider";

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-teal-100 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-teal-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-teal-700">
              Billing Dashboard
            </span>
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Building2 size={13} className="text-teal-600" />
              {hospitalName}
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Welcome, {user?.displayName}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Manage hospital claims, check denial reasons, and draft appeal letters with medical records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={RotateCcw}
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            title="Refresh dashboard data"
          >
            Refresh
          </Button>
          <Button icon={Plus} onClick={() => navigate("/claims?new=1")}>
            New Claim
          </Button>
        </div>
      </div>

      {/* Key Summary Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={ClipboardCheck}
          label="Total Claims"
          value={stats?.totalClaims ?? 0}
        />
        <StatCard
          icon={Send}
          label="Submitted"
          value={stats?.submittedClaims ?? 0}
          tone="blue"
        />
        <StatCard
          icon={CheckCircle2}
          label="Approved"
          value={stats?.approvedClaims ?? 0}
          tone="green"
        />
        <StatCard
          icon={FileWarning}
          label="Denied Claims"
          value={stats?.deniedClaims ?? 0}
          tone="amber"
        />
        <StatCard
          icon={FileClock}
          label="Pending Appeals"
          value={stats?.pendingAppeals ?? 0}
          tone="teal"
        />
      </div>

      {/* Main Grid: Denied Claims & Recent Appeals */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Actionable Denied Claims with AI Analysis CTA */}
        <Card className="p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <FileWarning size={16} className="text-amber-600" />
              <h2 className="text-sm font-bold text-slate-900">Actionable Denials</h2>
            </div>
            <Link to="/denials" className="text-xs font-semibold text-teal-700 hover:underline">
              View all denials &rarr;
            </Link>
          </div>
          <div className="mt-3 divide-y divide-slate-100 text-xs">
            {denials.length === 0 ? (
              <p className="py-4 text-center text-slate-400">No open denials found under your facility.</p>
            ) : (
              denials.slice(0, 5).map((denial) => (
                <div key={denial.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{denial.claim?.claimNumber}</span>
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                        {denial.denialReason?.code}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-slate-600">
                      {denial.claim?.patientName} &bull; {denial.denialReason?.title}
                    </div>
                    {denial.reasonText && (
                      <div className="mt-1 line-clamp-1 rounded bg-amber-50/90 px-2 py-0.5 text-[10px] text-amber-900 border border-amber-200/60">
                        Reason: {denial.reasonText}
                      </div>
                    )}
                    <div className="mt-1 text-[10px] text-slate-400">
                      Amount: {formatCurrency(denial.claim?.amount, denial.claim?.currency)} &bull; {formatDate(denial.denialDate)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Sparkles}
                    onClick={() => navigate(`/denials?selected=${denial.id}&claim=${denial.claimId}`)}
                  >
                    Analyse Denial with AI
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Appeal Letters Workspace */}
        <Card className="p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <FileClock size={16} className="text-teal-700" />
              <h2 className="text-sm font-bold text-slate-900">Appeal Letters Workspace</h2>
            </div>
            <Link to="/appeals/draft" className="text-xs font-semibold text-teal-700 hover:underline">
              Draft workspace &rarr;
            </Link>
          </div>
          <div className="mt-3 divide-y divide-slate-100 text-xs">
            {displayLetters.length === 0 ? (
              <p className="py-4 text-center text-slate-400">No appeal letters generated yet.</p>
            ) : (
              displayLetters.slice(0, 5).map((letter) => {
                const isClaimApproved = letter.claim?.status === "APPROVED" || letter.status === "APPROVED";
                const effectiveStatus = isClaimApproved ? "APPROVED" : letter.status;
                return (
                  <div key={letter.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">Claim {letter.claim?.claimNumber}</span>
                        <StatusBadge status={effectiveStatus} />
                      </div>
                      <div className="mt-0.5 truncate text-slate-600">
                        {letter.claim?.patientName} &bull; {letter.claim?.payerName}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        Rev #{letter.revisionNumber || 1} &bull; Last updated: {formatDate(letter.updatedAt)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={effectiveStatus === "REJECTED" ? "destructive" : effectiveStatus === "DRAFT" ? "default" : "secondary"}
                      className={
                        effectiveStatus === "REJECTED"
                          ? "bg-red-700 hover:bg-red-800 text-white font-bold"
                          : effectiveStatus === "APPROVED"
                          ? "border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 font-semibold"
                          : ""
                      }
                      onClick={() => {
                        if (effectiveStatus === "REJECTED") {
                          navigate(`/denials?claim=${letter.claimId}`);
                        } else {
                          navigate(`/appeals/draft?claim=${letter.claimId}&letter=${letter.id}`);
                        }
                      }}
                    >
                      {effectiveStatus === "REJECTED"
                        ? "Analyse & Re-Appeal \u2192"
                        : effectiveStatus === "DRAFT"
                        ? "Edit Draft"
                        : effectiveStatus === "APPROVED"
                        ? "Approved & Closed \u2192"
                        : "View"}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
