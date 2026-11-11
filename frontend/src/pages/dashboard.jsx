import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Activity, ArrowRight, ClipboardCheck, FileClock, FileWarning, Plus, ShieldCheck } from "lucide-react";
import { api } from "../api/client.js";
import { Card, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader, Pill, StatusPill } from "../components/ui.jsx";
import { formatCurrency, formatDate, titleCase } from "../lib/format.js";

export function DashboardPage() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = () => setRevision((value) => value + 1);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [claims, denials, letters] = await Promise.all([
        api.claims({ page: 1, limit: 50 }), api.denials({ page: 1, limit: 50 }), api.appealLetters({ page: 1, limit: 50 })
      ]);
      setSnapshot({ claims, denials, letters });
    } catch (failure) { setError(failure.message); }
    finally { setLoading(false); }
  }, [revision]);
  useEffect(() => { load(); }, [load]);

  if (loading && !snapshot) return <><PageHeader eyebrow="Overview" title="Dashboard" description="A current view of your claims and appeal work." /><LoadingState label="Loading your dashboard" /></>;
  if (error && !snapshot) return <><PageHeader eyebrow="Overview" title="Dashboard" description="A current view of your claims and appeal work." /><ErrorState message={error} onRetry={reload} /></>;

  const claims = snapshot?.claims.data || [];
  const denials = snapshot?.denials.data || [];
  const letters = snapshot?.letters.data || [];
  const pendingAppeals = letters.filter((letter) => ["DRAFT", "IN_REVIEW", "SUBMITTED"].includes(letter.status)).length;
  const approvedAppeals = letters.filter((letter) => letter.status === "APPROVED").length;
  const activities = [
    ...claims.map((item) => ({ id: "c-" + item.id, label: "Claim " + item.claimNumber, detail: "Claim record · " + titleCase(item.status), date: item.updatedAt || item.createdAt, icon: ClipboardCheck })),
    ...denials.map((item) => ({ id: "d-" + item.id, label: "Denial " + item.denialReason.code, detail: item.denialReason.title + " · " + item.claim.claimNumber, date: item.createdAt, icon: FileWarning })),
    ...letters.map((item) => ({ id: "a-" + item.id, label: "Appeal " + item.claim.claimNumber, detail: "Appeal letter · " + titleCase(item.status), date: item.updatedAt || item.createdAt, icon: FileClock }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

  return <>
    <PageHeader eyebrow="Overview" title="Dashboard" description="A current view of your claims and appeal work." actions={<Pill tone="teal"><ShieldCheck size={12} className="mr-1" />Secure workspace</Pill>} />
    {error && <div role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Some dashboard records could not be refreshed: {error}</div>}
    <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Metric label="Total claims" value={snapshot?.claims.pagination.total ?? 0} icon={ClipboardCheck} />
      <Metric label="Denied claims" value={claims.filter((claim) => claim.status === "DENIED").length} icon={FileWarning} tone="amber" />
      <Metric label="Pending appeals" value={pendingAppeals} icon={FileClock} tone="blue" />
      <Metric label="Approved appeals" value={approvedAppeals} icon={ShieldCheck} tone="green" />
    </div>
    <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
      <Card className="overflow-hidden">
        <CardHeader title="Recent claims" description="Your newest claim records" action={<Link to="/claims" className="text-xs font-semibold text-teal-800 hover:underline">View all</Link>} />
        {claims.length === 0 ? <EmptyState icon={ClipboardCheck} title="No claims yet" description="Claims added to your account will appear here." action={<Link to="/claims" className="text-xs font-semibold text-teal-800">Open claims</Link>} /> :
        <div className="overflow-x-auto"><table className="w-full min-w-[570px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Claim</th><th className="px-4 py-3">Payer</th><th className="px-4 py-3">Service date</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th></tr></thead>
          <tbody>{claims.slice(0, 5).map((claim) => <tr key={claim.id} className="border-t border-slate-100 hover:bg-slate-50/70">
            <td className="px-4 py-3"><Link className="font-semibold text-slate-800 hover:text-teal-800" to={"/claims/" + claim.id}>{claim.claimNumber}</Link></td>
            <td className="px-4 py-3 text-slate-600">{claim.payerName}</td><td className="px-4 py-3 text-slate-500">{formatDate(claim.serviceDate)}</td>
            <td className="px-4 py-3 text-slate-600">{formatCurrency(claim.amount, claim.currency)}</td><td className="px-4 py-3"><StatusPill status={claim.status} /></td>
          </tr>)}</tbody>
        </table></div>}
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Recent activity" description="Recent claim, denial, and letter updates" />
        {activities.length === 0 ? <EmptyState icon={Activity} title="No activity recorded" description="Your record activity will appear here as your account is used." /> :
          <div className="px-4">{activities.map((item) => {
            const Icon = item.icon;
            return <div key={item.id} className="flex items-start gap-3 border-b border-slate-100 py-3 last:border-0">
              <div className="grid size-8 shrink-0 place-items-center rounded-md bg-slate-50 text-slate-500"><Icon size={15} /></div>
              <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-slate-700">{item.label}</div><div className="mt-1 text-[10px] text-slate-500">{item.detail}</div></div>
              <time className="shrink-0 pt-0.5 text-[9px] text-slate-400">{formatDate(item.date, { month: "short", day: "numeric" })}</time>
            </div>;
          })}</div>}
      </Card>
    </div>
    <Card className="mt-4 overflow-hidden">
      <CardHeader title="Action needed" description="Follow up on open denial work" />
      {denials.length === 0 ? <EmptyState icon={ClipboardCheck} title="No open denials" description="There are no denial records to review for your account." /> :
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700"><FileWarning size={18} /></div>
          <div className="flex-1"><div className="text-xs font-semibold text-slate-700">{snapshot?.denials.pagination.total} denial records are available for review</div><div className="mt-1 text-[10px] text-slate-500">Compare each reason’s evidence requirements with records on the claim.</div></div>
          <Link to="/denials" className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800 hover:underline">Review denials <ArrowRight size={14} /></Link>
        </div>}
    </Card>
  </>;

  function Metric({ label, value, detail, icon: Icon, tone = "teal" }) {
    const colors = { teal: "bg-teal-50 text-teal-700", amber: "bg-amber-50 text-amber-700", blue: "bg-blue-50 text-blue-700", green: "bg-emerald-50 text-emerald-700" };
    return <Card className="p-4 sm:p-5"><div className={"mb-3 grid size-8 place-items-center rounded-md " + colors[tone]}><Icon size={16} /></div>
      <div className="text-[11px] font-medium text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold tracking-tight text-slate-800">{value}</div>{detail && <div className="mt-1 text-[10px] text-slate-400">{detail}</div>}</Card>;
  }
}

