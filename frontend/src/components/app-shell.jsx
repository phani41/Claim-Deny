import { useEffect, useState, useMemo } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  ClipboardList,
  FileCheck2,
  FileSearch2,
  Files,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
  Lock
} from "lucide-react";
import { api } from "../api/client.js";
import { useAuth } from "../context/auth-context.jsx";
import { Button } from "./ui.jsx";

const titles = {
  "/admin/dashboard": "Admin Dashboard",
  "/admin/users": "User Management",
  "/admin/knowledge-base": "Knowledge Base",
  "/knowledge-base": "Knowledge Library",
  "/billing/dashboard": "Billing Dashboard",
  "/reviewer/dashboard": "Reviewer Dashboard",
  "/dashboard": "Dashboard",
  "/claims": "Claims",
  "/denials": "Denials",
  "/evidence": "Medical Evidence",
  "/appeals/draft": "Appeal Draft",
  "/appeals/review": "Review Queue",
  "/unauthorized": "Access Restricted"
};

function initials(name) {
  return (name || "User")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getRoleLabel(role) {
  if (role === "ADMIN") return "Admin";
  if (role === "COMPLIANCE_REVIEWER" || role === "REVIEWER") return "Insurance Reviewer";
  if (role === "BILLING_SPECIALIST" || role === "PROVIDER") return "Hospital Biller";
  return "Staff";
}

function getRoleBadgeClass(role) {
  if (role === "ADMIN") return "bg-purple-50 text-purple-700 border-purple-200";
  if (role === "COMPLIANCE_REVIEWER" || role === "REVIEWER") return "bg-indigo-50 text-indigo-700 border-indigo-200";
  return "bg-teal-50 text-teal-800 border-teal-200";
}

export function AppShell() {
  const { user, logout, isAdmin, isReviewer, isBillingSpecialist } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [apiState, setApiState] = useState("checking");

  const canCreate = !isReviewer; // Reviewer cannot create or modify claims

  const navigation = useMemo(() => {
    if (isAdmin) {
      return [
        { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { to: "/admin/users", label: "User Management", icon: Users },
        { to: "/admin/knowledge-base", label: "Knowledge Base", icon: BookOpen },
        { to: "/claims", label: "Claims", icon: ClipboardList },
        { to: "/appeals/review", label: "Review Queue", icon: ShieldCheck }
      ];
    }
    if (isReviewer) {
      return [
        { to: "/reviewer/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { to: "/appeals/review", label: "Review Queue", icon: ShieldCheck },
        { to: "/claims", label: "Claims", icon: ClipboardList }
      ];
    }
    // Billing specialist / Provider
    return [
      { to: "/billing/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/claims", label: "Claims", icon: ClipboardList },
      { to: "/denials", label: "Denials", icon: FileSearch2 },
      { to: "/evidence", label: "Evidence", icon: Files },
      { to: "/appeals/draft", label: "Appeals", icon: FileCheck2 }
    ];
  }, [isAdmin, isReviewer, isBillingSpecialist]);

  const title = location.pathname.startsWith("/claims/")
    ? "Claim Details & Packet"
    : (titles[location.pathname] || "Healthcare Revenue Cycle");

  function closeMenu() {
    setMenuOpen(false);
  }

  useEffect(() => {
    let active = true;
    api.health()
      .then((result) => {
        if (active) setApiState(result.database === "ok" ? "online" : "offline");
      })
      .catch(() => {
        if (active) setApiState("offline");
      });
    return () => { active = false; };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile backdrop */}
      <button
        className={"fixed inset-0 z-20 bg-slate-950/25 " + (menuOpen ? "block lg:hidden" : "hidden")}
        type="button"
        aria-label="Close navigation"
        onClick={closeMenu}
      />

      {/* Sidebar */}
      <aside
        className={
          "fixed inset-y-0 left-0 z-30 flex w-[252px] -translate-x-full flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:translate-x-0 " +
          (menuOpen ? "translate-x-0 shadow-2xl" : "")
        }
      >
        {/* Brand */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-5">
          <div className="grid size-9 place-items-center rounded-lg bg-teal-700 text-white shadow-xs">
            <Activity size={18} />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-slate-800">ClaimDesk</div>
            <div className="flex items-center gap-1 mt-0.5 text-[9px] font-bold uppercase tracking-[.14em] text-teal-700">
              <span>Healthcare Portal</span>
            </div>
          </div>
          <button
            className="ml-auto grid size-7 place-items-center rounded-md bg-slate-100 text-slate-500 lg:hidden"
            type="button"
            aria-label="Close navigation"
            onClick={closeMenu}
          >
            <X size={16} />
          </button>
        </div>

        {/* Navigation Section */}
        <div className="px-4 pb-2 pt-6 text-[10px] font-bold uppercase tracking-[.13em] text-slate-400">
          Navigation
        </div>
        <nav className="grid gap-1 px-3" aria-label="Main navigation">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={closeMenu}
              className={({ isActive }) =>
                "flex min-h-10 items-center gap-3 rounded-md px-3 text-xs font-medium transition " +
                (isActive
                  ? "bg-teal-50 font-semibold text-teal-800"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")
              }
            >
              <Icon
                size={17}
                className={
                  location.pathname === to || (to !== "/dashboard" && location.pathname.startsWith(to))
                    ? "text-teal-700"
                    : "text-slate-400"
                }
              />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer Account Info */}
        <div className="mt-auto border-t border-slate-100 p-3">
          <div className="flex items-center gap-2.5 px-2 pt-1">
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-teal-100 text-[10px] font-bold text-teal-800">
              {initials(user?.displayName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold text-slate-800">{user?.displayName}</div>
              <div className="truncate text-[10px] text-slate-500 font-medium">
                {user?.organization?.name || (isAdmin ? "System Administrator" : "Healthcare Facility")}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className={`inline-block rounded border px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider ${getRoleBadgeClass(user?.role)}`}>
                  {getRoleLabel(user?.role)}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="grid size-8 place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-700"
              aria-label="Sign out"
              onClick={logout}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="min-h-screen lg:ml-[252px]">
        <div className="sticky top-0 z-10">
          <header className="flex h-[60px] items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-7">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                className="grid size-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 lg:hidden"
                aria-label="Open navigation"
                onClick={() => setMenuOpen(true)}
              >
                <Menu size={19} />
              </button>
              <div className="truncate text-sm font-semibold text-slate-800">{title}</div>
              <span className="hidden text-xs text-slate-300 sm:inline">/</span>
              <span className="hidden text-xs text-slate-500 sm:inline">
                {getRoleLabel(user?.role)}
                {user?.organization?.name ? ` • ${user.organization.name}` : ""}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-3">
            </div>
          </header>

          {/* Compliance Scrolling Notice: Strictly for Hospital Biller */}
          {isBillingSpecialist && (
            <div className="border-b border-amber-200/90 bg-gradient-to-r from-amber-50 via-amber-50/90 to-amber-50 px-3 sm:px-6 py-1.5 text-xs shadow-2xs">
              <div className="flex items-center gap-3">


                {/* Smooth Scrolling Marquee with pause on hover */}
                <div className="min-w-0 flex-1 overflow-hidden">
                  <marquee
                    behavior="scroll"
                    direction="left"
                    scrollamount="5"
                    onMouseEnter={(e) => e.target.stop()}
                    onMouseLeave={(e) => e.target.start()}
                    className="cursor-default font-medium text-slate-700 hover:text-slate-900 transition"
                  >
                    <span className="rounded bg-amber-200/80 px-1.5 py-0.5 font-bold text-amber-950">
                      ⚠️ MANDATORY HUMAN-IN-THE-LOOP REQUIREMENT:
                    </span>{" "}
                    AI cannot submit appeal letters autonomously. All AI-generated drafts require specialist review, clinical evidence verification, and manual human submission. &nbsp;&bull;&nbsp;{" "}

                    by healthcare compliance policy. &lt;&lt;&lt;
                  </marquee>
                </div>


              </div>
            </div>
          )}
        </div>

        <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
