export function formatDate(value, options = {}) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", ...options }).format(date);
}
export function formatCurrency(value, currency = "INR") {
  if (value && typeof value === "object") {
    if (value.d) {
      value = Array.isArray(value.d) ? value.d.join("") : value.d;
      if (value.s === -1) value = "-" + value;
    } else if (typeof value.toString === "function") {
      value = value.toString();
    }
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const curr = currency || "INR";
  const locale = curr === "INR" ? "en-IN" : "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency: curr, minimumFractionDigits: 2 }).format(amount);
}
export function titleCase(value = "") {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export const evidenceLabel = (value = "") => titleCase(value);

