import { useEffect, useState } from "react";
import { Card, KPI, Filter } from "../components/ui";

const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString());

export default function Overview() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);

  // build the URL safely (respects vite base)
  const METRICS_URL = `${import.meta.env.BASE_URL}data/clean/metrics.json`;

  useEffect(() => {
    fetch(METRICS_URL, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${METRICS_URL}`);
        return r.json();
      })
      .then((data) => {
        console.log("Loaded metrics.json:", data);
        setMetrics(data);
        setError(null);
      })
      .catch((err) => {
        console.error("Failed to load metrics.json", err);
        setMetrics(null);
        setError("No metrics found. Make sure metrics.json is in /public/data/clean/");
      });
  }, [METRICS_URL]);

  const lastSync = metrics?.generated_at
    ? new Date(metrics.generated_at).toLocaleString()
    : "—";
  const total = metrics?.rows_total ?? null;
  const completion = metrics?.completion_rate_pct ?? null;

  return (
    <div className="space-y-6">
      {error && (
        <div className="chip bg-amber-50 border-amber-300 text-amber-800">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Filter label="Client" /><Filter label="Project" />
        <Filter label="Survey" /><Filter label="Date Range" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Total Responses" value={fmt(total)} sub={`Last sync: ${lastSync}`} />
        <KPI label="Completion Rate" value={completion == null ? "—" : `${completion}%`} sub="Target: 85%" />
        <KPI label="Error Rate" value="—" sub="(coming from QA checks)" />
        <KPI label="Active Researchers" value="—" sub="(coming soon)" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartBox title="Daily Submissions" />
        <ChartBox title="Completion Forecast" />
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Key Predictive Highlights</div>
          <ul className="text-sm space-y-2 list-disc list-inside text-zinc-600">
            <li>Top Expected Segment: Panel 1 (placeholder)</li>
            <li>Risk: Region C low traction (placeholder)</li>
            <li>Next Best Action: Weekend pushes in Region B (placeholder)</li>
          </ul>
        </Card>
      </div>

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
          <div className="text-sm font-medium mb-3">Survey Selection</div>
          <div className="h-24 rounded-xl border border-dashed grid place-items-center text-xs text-zinc-500">
            Dropdown / multi-select placeholder
          </div>
        </Card>
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
