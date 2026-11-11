import { useState } from "react";
import { z } from "zod";
import { useLocation, useNavigate } from "react-router";
import { Activity, Building2, ShieldCheck, Lock } from "lucide-react";
import { Button, Field } from "../components/ui.jsx";
import { useAuth, getDefaultRoute } from "../context/auth-context.jsx";

const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address."),
  password: z.string().min(1, "Please enter your password.")
});

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setServerError("");
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message])));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const loggedUser = await login({ email: parsed.data.email, password: parsed.data.password });
      const targetDefault = getDefaultRoute(loggedUser?.role);
      const destination = location.state?.from || targetDefault;
      navigate(destination, { replace: true });
    } catch (error) {
      setServerError(error.message || "Failed to sign in. Please check your credentials.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[1fr_1.1fr]">
      {/* Left Clean Welcome Panel */}
      <aside className="flex flex-col justify-between bg-slate-900 px-8 py-8 text-white sm:px-12 lg:min-h-screen lg:px-14 lg:py-12">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-teal-500 text-slate-950 font-bold">
              <Activity size={20} />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">ClaimDesk</div>
              <div className="text-xs text-slate-400">Claims & Appeal Assistant</div>
            </div>
          </div>

          <div className="mt-12 max-w-md">
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Simple claim review and appeal management.
            </h1>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              A clear tool for hospital billers to analyze claim denials and draft appeals, and for insurance reviewers to quickly approve or deny claims.
            </p>

            <div className="mt-8 space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-800/60 p-4">
                <Building2 className="mt-0.5 shrink-0 text-teal-400" size={18} />
                <div className="text-xs">
                  <div className="font-semibold text-white">Hospital Biller Portal</div>
                  <div className="mt-0.5 text-slate-400">
                    View claim status, see why claims were denied, and create appeal letters with medical records.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-800/60 p-4">
                <ShieldCheck className="mt-0.5 shrink-0 text-indigo-400" size={18} />
                <div className="text-xs">
                  <div className="font-semibold text-white">Insurance Reviewer Portal</div>
                  <div className="mt-0.5 text-slate-400">
                    Check hospital claims, approve or deny requests, and review submitted appeal letters.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 text-xs text-slate-500">
          ClaimDesk Assistant &bull; Hospital & Payer Gateway
        </div>
      </aside>

      {/* Right Login Section */}
      <main className="flex min-h-full flex-col justify-center bg-slate-50 px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Sign In</h2>
            <p className="mt-1 text-xs text-slate-600">
              Enter your authorized email address and password to access the portal.
            </p>
          </div>

          {/* Sign In Form */}
          <form className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs" onSubmit={submit} noValidate autoComplete="off">
            {serverError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {serverError}
              </div>
            )}

            <Field
              label="Email Address"
              name="account_email"
              id="account_email"
              type="email"
              autoComplete="off"
              placeholder="Enter your email address"
              value={values.email}
              error={errors.email}
              onChange={(e) => setValues({ ...values, email: e.target.value })}
            />

            <Field
              label="Password"
              name="account_password"
              id="account_password"
              type="password"
              autoComplete="new-password"
              placeholder="Enter your password"
              value={values.password}
              error={errors.password}
              onChange={(e) => setValues({ ...values, password: e.target.value })}
            />

            <Button type="submit" size="lg" loading={submitting} className="w-full mt-2">
              {submitting ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
