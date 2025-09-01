import { ChevronRight } from "lucide-react";

export function Card({ className = "", children }) {
  return <div className={`card ${className}`}>{children}</div>;
}
export function KPI({ label, value, sub }) {
  return (
    <div className="kpi">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}
export function Filter({ label }) {
  return <div className="chip">{label}</div>;
}
export function Breadcrumb({ active }) {
  const map = {
    overview: "Market Research Overview",
    completion: "Completion Details",
    predictive: "Predictive Insights",
    field: "Field Management",
    audit: "Audit Trail",
  };
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-600">
      <span className="hidden sm:inline">Dashboard</span>
      <ChevronRight size={14} className="hidden sm:inline" />
      <span className="font-medium text-zinc-900">{map[active] || "Dashboard"}</span>
    </div>
  );
}
