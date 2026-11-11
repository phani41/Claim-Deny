import { useState, useRef, useEffect } from "react";
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, TriangleAlert, X } from "lucide-react";

const buttonStyles = {
  primary: "bg-teal-700 text-white shadow-sm hover:bg-teal-800 focus-visible:ring-teal-600",
  default: "bg-teal-700 text-white shadow-sm hover:bg-teal-800 focus-visible:ring-teal-600",
  outline: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
};
export function Button({ children, variant = "primary", size = "md", icon: Icon, loading = false, className = "", type = "button", ...props }) {
  const sizeClass = size === "sm" ? "min-h-8 px-2.5 text-xs" : size === "lg" ? "min-h-11 px-4 text-sm" : "min-h-9 px-3 text-xs";
  return <button type={type} className={"inline-flex items-center justify-center gap-2 rounded-md font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 " + sizeClass + " " + (buttonStyles[variant] || buttonStyles.primary) + " " + className} {...props}>
    {loading ? <LoaderCircle size={15} className="animate-spin" /> : Icon ? <Icon size={15} aria-hidden="true" /> : null}{children}
  </button>;
}
export function Card({ children, className = "" }) {
  return <section className={"rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.02] " + className}>{children}</section>;
}
export function CardHeader({ title, description, action, className = "" }) {
  return <div className={"flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5 " + className}>
    <div><h2 className="text-sm font-semibold text-slate-800">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}</div>{action}
  </div>;
}
export function Pill({ children, tone = "neutral" }) {
  const tones = {
    neutral: "border-slate-200 bg-slate-50 text-slate-600",
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    teal: "border-teal-200 bg-teal-50 text-teal-800"
  };
  return <span className={"inline-flex min-h-5 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold " + (tones[tone] || tones.neutral)}>{children}</span>;
}
export function StatusPill({ status }) {
  const value = status || "UNKNOWN";
  const tones = { DENIED: "red", OPEN: "red", REJECTED: "red", REQUIRES_CORRECTION: "amber", APPEALED: "amber", IN_REVIEW: "amber", SUBMITTED: "blue", PAID: "green", RESOLVED: "green", APPROVED: "green" };
  return <Pill tone={tones[value] || "neutral"}>{value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</Pill>;
}
export function PageHeader({ eyebrow, title, description, actions }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>{eyebrow && <div className="text-[10px] font-bold uppercase tracking-[.14em] text-teal-700">{eyebrow}</div>}
      <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-slate-800 sm:text-[29px]">{title}</h1>
      {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>}</div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>;
}
export function Field({ label, error, hint, className = "", ...props }) {
  const id = props.id || props.name;
  return <label className={"grid min-w-0 gap-1.5 " + className} htmlFor={id}>
    <span className="text-xs font-semibold text-slate-600">{label}</span>
    <input id={id} className={"min-h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-600/10 " + (error ? "border-red-400" : "border-slate-200")} aria-invalid={Boolean(error)} {...props} />
    {error ? <span className="text-xs text-red-700">{error}</span> : hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
  </label>;
}
export function SelectField({ label, error, hint, children, className = "", ...props }) {
  const id = props.id || props.name;
  return <label className={"grid min-w-0 gap-1.5 " + className} htmlFor={id}>
    <span className="text-xs font-semibold text-slate-600">{label}</span>
    <select id={id} className={"min-h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-600/10 " + (error ? "border-red-400" : "border-slate-200")} aria-invalid={Boolean(error)} {...props}>{children}</select>
    {error ? <span className="text-xs text-red-700">{error}</span> : hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
  </label>;
}
export function TextAreaField({ label, error, hint, className = "", ...props }) {
  const id = props.id || props.name;
  return <label className={"grid min-w-0 gap-1.5 " + className} htmlFor={id}>
    <span className="text-xs font-semibold text-slate-600">{label}</span>
    <textarea id={id} className={"w-full resize-y rounded-md border bg-white px-3 py-2.5 text-sm leading-6 text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-600/10 " + (error ? "border-red-400" : "border-slate-200")} aria-invalid={Boolean(error)} {...props} />
    {error ? <span className="text-xs text-red-700">{error}</span> : hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
  </label>;
}
export function LoadingState({ label = "Loading records" }) {
  return <div className="flex min-h-28 items-center gap-3 rounded-lg border border-slate-200 bg-white p-5 text-slate-500" role="status"><LoaderCircle className="animate-spin text-teal-700" size={21} /><div><strong className="block text-sm text-slate-700">{label}</strong><span className="mt-1 block text-xs">Connecting to your secure workspace</span></div></div>;
}
export function ErrorState({ message, onRetry }) {
  return <div className="flex min-h-28 items-center gap-3 rounded-lg border border-red-200 bg-white p-5" role="alert"><TriangleAlert className="shrink-0 text-red-600" size={21} /><div className="min-w-0 flex-1"><strong className="block text-sm text-slate-800">We couldn’t load this view</strong><span className="mt-1 block text-xs leading-5 text-slate-500">{message}</span></div>{onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}</div>;
}
export function EmptyState({ icon: Icon, title, description, action }) {
  return <div className="flex min-h-44 flex-col items-center justify-center px-5 py-8 text-center">
    <div className="mb-3 grid size-11 place-items-center rounded-full border border-teal-100 bg-teal-50 text-teal-700">{Icon && <Icon size={20} />}</div>
    <strong className="text-sm font-semibold text-slate-700">{title}</strong><p className="mt-1 max-w-md text-xs leading-5 text-slate-500">{description}</p>{action && <div className="mt-3">{action}</div>}
  </div>;
}
export function Pagination({ pagination, onChange }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
    <span>{pagination.total} records</span><div className="flex items-center gap-2">
      <Button variant="outline" size="sm" icon={ChevronLeft} disabled={pagination.page <= 1} onClick={() => onChange(pagination.page - 1)}>Previous</Button>
      <span className="min-w-16 text-center">Page {pagination.page} of {pagination.totalPages}</span>
      <Button variant="outline" size="sm" icon={ChevronRight} disabled={pagination.page >= pagination.totalPages} onClick={() => onChange(pagination.page + 1)}>Next</Button>
    </div>
  </div>;
}
export function StateMessage({ children, tone = "amber" }) {
  const Icon = tone === "red" ? CircleAlert : tone === "green" ? CheckCircle2 : TriangleAlert;
  const colors = tone === "red" ? "border-red-200 bg-red-50 text-red-800" : tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900";
  return <div className={"flex gap-2.5 rounded-md border p-3 text-xs leading-5 " + colors}><Icon className="mt-0.5 shrink-0" size={16} /><div>{children}</div></div>;
}

export function StatCard({ label, value, meta, icon: Icon, tone = "teal" }) {
  const colors = {
    teal: "bg-teal-50 text-teal-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    indigo: "bg-indigo-50 text-indigo-700",
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700"
  };
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
        {Icon && <div className={"grid size-8 place-items-center rounded-md " + (colors[tone] || colors.teal)}><Icon size={16} /></div>}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</div>
      {meta && <div className="mt-1 text-[11px] text-slate-500">{meta}</div>}
    </Card>
  );
}

export function StatusBadge({ status }) {
  const value = status || "UNKNOWN";
  const tones = {
    DENIED: "red",
    OPEN: "red",
    REJECTED: "red",
    REQUIRES_CORRECTION: "amber",
    APPEALED: "amber",
    IN_REVIEW: "amber",
    APPEAL_DRAFT: "amber",
    DRAFT: "amber",
    SUBMITTED: "blue",
    SUBMITTED_FOR_REVIEW: "blue",
    UNDER_REVIEW: "blue",
    PAID: "green",
    RESOLVED: "green",
    APPROVED: "green",
    CLOSED: "neutral"
  };

  if (value === "APPROVED") {
    return (
      <span className="inline-flex items-center gap-1">
        <Pill tone="green">Approved</Pill>
        <Pill tone="neutral">Closed</Pill>
      </span>
    );
  }

  return <Pill tone={tones[value] || "neutral"}>{value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</Pill>;
}

export function Modal({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs transition-opacity" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Input({ className = "", ...props }) {
  return (
    <input
      className={"min-h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50 " + className}
      {...props}
    />
  );
}

export function Select({ options = [], className = "", ...props }) {
  return (
    <select
      className={"min-h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50 " + className}
      {...props}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function CheckboxMultiSelect({
  label,
  options = [],
  selected = [],
  onChange,
  placeholder = "Select required missing document(s)...",
  className = ""
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  function toggle(value) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  function selectAll() {
    onChange(options.map((o) => o.value));
  }

  function clearAll() {
    onChange([]);
  }

  const selectedLabels = options.filter((o) => selected.includes(o.value)).map((o) => o.label);

  return (
    <div className={"relative " + className} ref={containerRef}>
      {label && (
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-semibold text-slate-700">
            {label}
          </label>
          {selected.length > 0 && (
            <span className="text-[10px] font-bold text-red-800 bg-red-50 px-2 py-0.5 rounded border border-red-200">
              {selected.length} document{selected.length > 1 ? "s" : ""} required
            </span>
          )}
        </div>
      )}

      {/* Dropdown Button Trigger */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={
          "w-full flex items-center justify-between rounded-md border bg-white px-3 py-2 text-xs text-left transition shadow-2xs cursor-pointer " +
          (open ? "border-red-500 ring-1 ring-red-500" : selected.length > 0 ? "border-red-300 bg-red-50/20" : "border-slate-200 hover:border-slate-300")
        }
      >
        <span className={selected.length === 0 ? "text-slate-400" : "font-medium text-slate-800 truncate"}>
          {selected.length === 0
            ? placeholder
            : `${selected.length} document(s) checked: ${selectedLabels.join(", ")}`}
        </span>
        <ChevronDown size={14} className={"text-slate-400 shrink-0 ml-2 transition-transform duration-150 " + (open ? "rotate-180 text-red-600" : "")} />
      </button>

      {/* Floating Dropdown Menu with Checkboxes */}
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-xl space-y-1">
          <div className="flex items-center justify-between px-2 py-1 text-[11px] border-b border-slate-100 text-slate-500 font-semibold">
            <span>Check all required documents:</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="text-teal-700 hover:text-teal-900 font-bold cursor-pointer"
              >
                Select All
              </button>
              <span>&bull;</span>
              <button
                type="button"
                onClick={clearAll}
                className="text-slate-500 hover:text-red-600 cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="py-1 space-y-0.5">
            {options.map((option) => {
              const isChecked = selected.includes(option.value);
              return (
                <label
                  key={option.value}
                  className={
                    "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition select-none " +
                    (isChecked ? "bg-red-50/80 font-bold text-red-950 border border-red-200/60" : "hover:bg-slate-50 text-slate-700")
                  }
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(option.value)}
                    className="size-4 rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer accent-red-600"
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected tags badges */}
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {options
            .filter((o) => selected.includes(o.value))
            .map((o) => (
              <span
                key={o.value}
                className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-900 border border-red-200 shadow-2xs"
              >
                {o.label}
                <button
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="text-red-500 hover:text-red-800 cursor-pointer ml-0.5 font-bold"
                  title="Remove document"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

