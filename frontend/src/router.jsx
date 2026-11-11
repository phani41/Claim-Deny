import { Navigate, Outlet, Route, Routes } from "react-router";
import { useAuth, getDefaultRoute } from "./context/auth-context.jsx";
import { ToastProvider } from "./context/toast-context.jsx";
import { AppShell } from "./components/app-shell.jsx";
import { LoginPage } from "./pages/login.jsx";
import { AdminDashboardPage } from "./pages/admin-dashboard.jsx";
import { AdminUsersPage } from "./pages/admin-users.jsx";
import { BillingDashboardPage } from "./pages/billing-dashboard.jsx";
import { ReviewerDashboardPage } from "./pages/reviewer-dashboard.jsx";
import { ClaimsPage } from "./pages/claims.jsx";
import { ClaimDetailPage } from "./pages/claim-detail.jsx";
import { DenialAnalysisPage } from "./pages/denial-analysis.jsx";
import { EvidenceWorkspacePage } from "./pages/evidence-workspace.jsx";
import { AppealDraftPage } from "./pages/appeal-draft.jsx";
import { ReviewFinalizePage } from "./pages/review-finalize.jsx";
import { AdminKnowledgeBasePage } from "./pages/admin-knowledge-base.jsx";
import { KnowledgeBaseViewerPage } from "./pages/knowledge-base-viewer.jsx";
import { UnauthorizedPage } from "./pages/unauthorized.jsx";

function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="size-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
      </div>
    );
  }
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

function RoleGuard({ allowedRoles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <UnauthorizedPage />;
  }
  return <Outlet />;
}

function RoleDashboardRedirect() {
  const { user } = useAuth();
  return <Navigate to={getDefaultRoute(user?.role)} replace />;
}

function AppealsRedirect() {
  const { user, isReviewer } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={isReviewer ? "/appeals/review" : "/appeals/draft"} replace />;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="size-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
      </div>
    );
  }
  return user ? <Navigate to={getDefaultRoute(user.role)} replace /> : <LoginPage />;
}

export default function RouterApp() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            {/* Index and generic dashboard redirect to user's role-specific dashboard */}
            <Route index element={<RoleDashboardRedirect />} />
            <Route path="/dashboard" element={<RoleDashboardRedirect />} />

            {/* Admin Routes */}
            <Route element={<RoleGuard allowedRoles={["ADMIN"]} />}>
              <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/knowledge-base" element={<AdminKnowledgeBasePage />} />
              <Route path="/knowledge-base" element={<KnowledgeBaseViewerPage />} />
            </Route>

            {/* Billing Specialist Routes */}
            <Route element={<RoleGuard allowedRoles={["BILLING_SPECIALIST", "PROVIDER", "ADMIN"]} />}>
              <Route path="/billing/dashboard" element={<BillingDashboardPage />} />
              <Route path="/denials" element={<DenialAnalysisPage />} />
              <Route path="/evidence" element={<EvidenceWorkspacePage />} />
              <Route path="/appeals/draft" element={<AppealDraftPage />} />
            </Route>

            {/* Reviewer Routes */}
            <Route element={<RoleGuard allowedRoles={["REVIEWER", "COMPLIANCE_REVIEWER", "ADMIN"]} />}>
              <Route path="/reviewer/dashboard" element={<ReviewerDashboardPage />} />
              <Route path="/appeals/review" element={<ReviewFinalizePage />} />
            </Route>

            {/* Shared Authenticated Routes */}
            <Route path="/appeals" element={<AppealsRedirect />} />
            <Route path="/claims" element={<ClaimsPage />} />
            <Route path="/claims/:id" element={<ClaimDetailPage />} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
