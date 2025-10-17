// frontend/src/pages/admin/Overview.jsx
import { useEffect, useState } from "react";
import { Card, KPI, Filter } from "../../components/ui";
import UploadData from "../../components/UploadData";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5050";
const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString());

/**
 * Props:
 *   selectedDataset: string (UUID or numeric id) - REQUIRED
 */
export default function Overview({ selectedDataset }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let abort = false;

    (async () => {
      if (!selectedDataset) {
        setSummary(null);
        setErr("");
        return;
      }
      setLoading(true);
      try {
        // ✅ new endpoint
        const res = await fetch(`${API_BASE}/api/dataset/${selectedDataset}/summary`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to load summary");
        const data = await res.json();
        if (abort) return;
        setSummary(data);
        setErr("");
      } catch (e) {
        console.error("analytics load failed", e);
        if (!abort) {
          setSummary(null);
          setErr("Failed to load analytics for the selected dataset.");
        }
      } finally {
        if (!abort) setLoading(false);
      }
    })();

    return () => { abort = true; };
  }, [selectedDataset]);

  // Derive KPI values from summary payload (fallbacks for empty)
  const respondentCount = summary?.respondent_count ?? null;
  const factCount = summary?.fact_count ?? null;
  const lastSync = "—"; // (optional) add computed_at if you later store it server-side

  // Map backend by_region [{region, c}] to your UI’s expected shape (cnt)
  const topRegions = Array.isArray(summary?.by_region)
    ? summary.by_region.map(r => ({ region: r.region, cnt: r.c }))
    : [];

  return (
    <div className="space-y-6">
      {err && (
        <div className="chip bg-amber-50 border-amber-300 text-amber-800">
          {err}
        </div>
      )}

      {/* Filters (UI only for now) */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter label="Client" /><Filter label="Project" />
        <Filter label="Survey" /><Filter label="Date Range" />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Total Responses" value={loading ? "…" : fmt(respondentCount)} sub={`Last sync: ${lastSync}`} />
        <KPI label="Facts Indexed" value={loading ? "…" : fmt(factCount)} sub="Long-form Q/A facts" />
        <KPI label="Completion Rate" value="—" sub="Target: 85%" />
        <KPI label="Error Rate" value="—" sub="(coming from QA checks)" />
      </div>

      {/* Charts + Highlights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartBox title="Daily Submissions" />
        <ChartBox title="Completion Forecast" />
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Key Predictive Highlights</div>
          <ul className="text-sm space-y-2 list-disc list-inside text-zinc-600">
            <li>Top Expected Segment: (placeholder)</li>
            <li>Risk: (placeholder)</li>
            <li>Next Best Action: (placeholder)</li>
          </ul>
        </Card>
      </div>

      {/* Data Health + Survey Selection */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Data Health Snapshot</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>Missing fields <span className="font-semibold">—</span></div>
            <div>Duplicates <span className="font-semibold">—</span></div>
            <div>Outliers flagged <span className="font-semibold">—</span></div>
            <div>Last ETL <span className="font-semibold">{lastSync}</span></div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Top Regions</div>
          <ul className="text-sm space-y-1 text-zinc-700">
            {(!topRegions || topRegions.length === 0) && <li>—</li>}
            {topRegions?.slice(0, 5).map((r, i) => (
              <li key={i}>{(r.region ?? "—")} — {fmt(r.cnt ?? 0)}</li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Upload Data (bottom) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <UploadData />
      </div>
    </div>
  );
}

function ChartBox({ title }) {
  return (
    <div className="card p-4 h-64">
      <div className="text-sm font-medium mb-3">{title}</div>
      <div className="h-full grid place-items-center text-zinc-400">
        <div className="rounded-xl border border-dashed px-4 py-2 text-xs">Chart placeholder</div>
      </div>
    </div>
  );
}
