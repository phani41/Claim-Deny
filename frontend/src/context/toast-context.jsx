import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";

const ToastContext = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const dismiss = useCallback((id) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const notify = useCallback((message, type = "success") => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, message, type }]);
    window.setTimeout(() => dismiss(id), 4200);
  }, [dismiss]);
  const value = useMemo(() => ({ notify }), [notify]);

  return <ToastContext.Provider value={value}>
    {children}
    <div className="fixed bottom-4 right-4 z-[60] grid w-[min(360px,calc(100vw-2rem))] gap-2" aria-live="polite">
      {items.map((item) => {
        const Icon = item.type === "error" ? CircleAlert : CheckCircle2;
        return <div key={item.id} role="status" className={"flex items-center gap-3 rounded-lg border bg-white p-3 text-sm shadow-lg " + (item.type === "error" ? "border-red-200 text-red-800" : "border-emerald-200 text-emerald-900")}>
          <Icon size={18} /><span className="flex-1">{item.message}</span>
          <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Dismiss notification" onClick={() => dismiss(item.id)}><X size={16} /></button>
        </div>;
      })}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider.");
  return value;
}

