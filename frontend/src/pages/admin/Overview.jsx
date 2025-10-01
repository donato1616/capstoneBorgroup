// frontend/src/pages/admin/Overview.jsx
import { useEffect, useState } from "react";
import { Card, KPI, Filter } from "../../components/ui";
import UploadData from "../../components/UploadData";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";
const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString());

/**
 * Props:
 *   selectedDataset: string (UUID or legacy id) - REQUIRED
 */
export default function Overview({ selectedDataset }) {
  const [analytics, setAnalytics] = useState({ descriptive: null, predictive: null, prescriptive: null });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      if (!selectedDataset) {
        setAnalytics({ descriptive: null, predictive: null, prescriptive: null });
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/datasets/${selectedDataset}/analytics`, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setAnalytics(data);
        setErr("");
      } catch (e) {
        console.error("analytics load failed", e);
        setAnalytics({ descriptive: null, predictive: null, prescriptive: null });
        setErr("Failed to load analytics for the selected dataset.");
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedDataset]);

  const kpis = analytics?.descriptive?.kpis || {};
  const lastSync = analytics?.descriptive?.computed_at
    ? new Date(analytics.descriptive.computed_at).toLocaleString()
    : "—";
  const total = kpis.rows ?? null;
  const topRegions = Array.isArray(kpis.top_regions) ? kpis.top_regions : [];

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
        <KPI label="Total Responses" value={loading ? "…" : fmt(total)} sub={`Last sync: ${lastSync}`} />
        <KPI label="Completion Rate" value="—" sub="Target: 85%" />
        <KPI label="Error Rate" value="—" sub="(coming from QA checks)" />
        <KPI label="Active Researchers" value="—" sub="(coming soon)" />
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
            {topRegions.length === 0 && <li>—</li>}
            {topRegions.map((r, i) => (
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
