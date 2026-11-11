import { useNavigate } from "react-router";
import { ShieldAlert, ArrowLeft, Home } from "lucide-react";
import { useAuth, getDefaultRoute } from "../context/auth-context.jsx";
import { Button, Card } from "../components/ui.jsx";

export function UnauthorizedPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const defaultRoute = getDefaultRoute(user?.role);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
      <Card className="max-w-md p-8 shadow-sm">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-red-50 text-red-600 ring-8 ring-red-50/50">
          <ShieldAlert size={28} />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Access Restricted</h1>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Your current account role <span className="font-semibold text-slate-700">({user?.role || "UNKNOWN"})</span> does not have authorization to view this page or action.
        </p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate(-1)}>
            Go Back
          </Button>
          <Button icon={Home} onClick={() => navigate(defaultRoute)}>
            Role Dashboard
          </Button>
        </div>
      </Card>
    </div>
  );
}

