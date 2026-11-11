import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { 
  Users, 
  FileText, 
  AlertCircle, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  IndianRupee, 
  ShieldCheck, 
  UserPlus, 
  ArrowRight,
  Database,
  Activity
} from "lucide-react";
import { api } from "../api/client.js";
import { formatCurrency, formatDate } from "../lib/format.js";
import { Button, Card, EmptyState, StatCard, StatusBadge } from "../components/ui.jsx";

export function AdminDashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.adminStats()
      .then((data) => {
        if (active) {
          setStats(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err.message || "Failed to load system statistics");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Could not load administration dashboard"
        description={error}
        action={<Button onClick={() => window.location.reload()}>Retry</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-teal-100 bg-gradient-to-r from-teal-900 via-teal-800 to-slate-900 p-6 text-white shadow-sm sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-teal-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-teal-200">
              System Administration
            </span>
            <span className="text-xs text-teal-200/70">Indian Healthcare Provider Portal</span>
          </div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight">Executive Operations & Analytics</h1>
          <p className="mt-1 text-xs text-teal-100/80">
            Real-time tracking of claims, denial mitigation, appeal approval workflows, and role governance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            className="border-white/20 bg-white/10 text-white hover:bg-white/20"
            icon={Users}
            onClick={() => navigate("/admin/users")}
          >
            Manage Users
          </Button>
          <Button
            className="bg-teal-500 text-slate-950 hover:bg-teal-400"
            icon={FileText}
            onClick={() => navigate("/claims")}
          >
            View All Claims
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={FileText}
          label="Total Claims"
          value={stats?.claims?.total ?? 0}
        />
        <StatCard
          icon={AlertCircle}
          label="Denied Claims"
          value={stats?.claims?.denied ?? 0}
          tone="amber"
        />
        <StatCard
          icon={Clock}
          label="Pending Review"
          value={stats?.appealLetters?.submittedForReview ?? 0}
          tone="blue"
        />
        <StatCard
          icon={CheckCircle2}
          label="Approved Appeals"
          value={stats?.appealLetters?.approved ?? 0}
          tone="green"
        />
      </div>

      {/* Governance & Appeal Pipeline */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* User Distribution Card */}
        <Card className="p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Users size={16} className="text-teal-700" />
              <span>User Governance</span>
            </div>
            <Link to="/admin/users" className="text-xs font-semibold text-teal-700 hover:underline">
              Manage users &rarr;
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">Total User Accounts</span>
              <span className="font-bold text-slate-900">{stats?.users?.total ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">Billing Specialists</span>
              <span className="font-semibold text-teal-700">{stats?.users?.byRole?.BILLING_SPECIALIST ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">Medical / Compliance Reviewers</span>
              <span className="font-semibold text-indigo-700">{stats?.users?.byRole?.COMPLIANCE_REVIEWER || stats?.users?.byRole?.REVIEWER || 0}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">System Administrators</span>
              <span className="font-semibold text-amber-700">{stats?.users?.byRole?.ADMIN ?? 0}</span>
            </div>
            <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-xs">
              <span className="text-slate-500">Account Status</span>
              <span className="font-medium text-slate-700">
                <span className="text-emerald-600 font-semibold">{stats?.users?.active ?? 0} Active</span> / <span className="text-slate-400">{stats?.users?.inactive ?? 0} Inactive</span>
              </span>
            </div>
          </div>
        </Card>

        {/* Appeal Lifecycle Stats */}
        <Card className="p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Activity size={16} className="text-teal-700" />
              <span>Appeal Workflow Pipeline</span>
            </div>
            <Link to="/appeals/review" className="text-xs font-semibold text-teal-700 hover:underline">
              Review queue &rarr;
            </Link>
          </div>
          <div className="mt-4 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Total Appeal Letters</span>
              <span className="font-bold text-slate-900">{stats?.appealLetters?.total ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Drafts in Progress</span>
              <span className="font-semibold text-amber-700">{stats?.appealLetters?.draft ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Submitted for Review</span>
              <span className="font-semibold text-sky-700">{stats?.appealLetters?.submittedForReview ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Final Approved</span>
              <span className="font-semibold text-emerald-700">{stats?.appealLetters?.approved ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Returned for Revision</span>
              <span className="font-semibold text-red-600">{stats?.appealLetters?.rejected ?? 0}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent Activity Table */}
      <Card className="p-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Activity size={17} className="text-teal-700" />
            <h2 className="text-sm font-bold text-slate-900">Recent Claims Activity</h2>
          </div>
          <Link to="/claims" className="text-xs font-semibold text-teal-700 hover:underline">
            View All Claims &rarr;
          </Link>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="pb-2 font-semibold">Claim ID</th>
                <th className="pb-2 font-semibold">Patient</th>
                <th className="pb-2 font-semibold">Hospital</th>
                <th className="pb-2 font-semibold">Payer</th>
                <th className="pb-2 font-semibold text-right">Amount (₹)</th>
                <th className="pb-2 font-semibold text-center">Status</th>
                <th className="pb-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {(stats?.recentClaims || []).map((claim) => (
                <tr key={claim.id} className="hover:bg-slate-50/80">
                  <td className="py-2.5 font-semibold text-slate-900">{claim.claimNumber}</td>
                  <td className="py-2.5 text-slate-800">{claim.patientName || "—"}</td>
                  <td className="py-2.5 text-slate-600 truncate max-w-xs">{claim.hospitalName || "—"}</td>
                  <td className="py-2.5 text-slate-600">{claim.payerName}</td>
                  <td className="py-2.5 text-right font-medium text-slate-900">
                    {formatCurrency(claim.amount, claim.currency)}
                  </td>
                  <td className="py-2.5 text-center">
                    <StatusBadge status={claim.status} />
                  </td>
                  <td className="py-2.5 text-right">
                    <Link
                      to={`/claims/${claim.id}`}
                      className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:underline"
                    >
                      Inspect <ArrowRight size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

