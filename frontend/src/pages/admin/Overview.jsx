import { useEffect, useRef, useState } from "react";
import { Card, KPI, Filter } from "../../components/ui";
import UploadData from "../../components/UploadData";  // <-- NEW import

const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString());

export default function Overview() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);

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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter label="Client" /><Filter label="Project" />
        <Filter label="Survey" /><Filter label="Date Range" />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Total Responses" value={fmt(total)} sub={`Last sync: ${lastSync}`} />
        <KPI label="Completion Rate" value={completion == null ? "—" : `${completion}%`} sub="Target: 85%" />
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
            <li>Top Expected Segment: Panel 1 (placeholder)</li>
            <li>Risk: Region C low traction (placeholder)</li>
            <li>Next Best Action: Weekend pushes in Region B (placeholder)</li>
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
          <div className="text-sm font-medium mb-3">Survey Selection</div>
          <div className="h-24 rounded-xl border border-dashed grid place-items-center text-xs text-zinc-500">
            Dropdown / multi-select placeholder
          </div>
        </Card>
      </div>

      {/* Upload Data (bottom) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <UploadData /> {/* <-- cleaner now, since it’s imported */}
      </div>

      {/* Ping Test */}
      <PingTest />
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

// PingTest component
function PingTest() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const API_BASE = import.meta.env.VITE_API_BASE || "";
  const PING_URL = `${API_BASE}/api/ping`;

  const onTest = async () => {
    setResult(null);
    setError(null);
    try {
      const res = await fetch(PING_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Backend Connection Test</div>
          <p className="text-xs text-zinc-500">Check API ↔ DB health</p>
        </div>
        <button
          type="button"
          onClick={onTest}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-900 text-white hover:opacity-90"
        >
          Ping
        </button>
      </div>

      {result && (
        <div className="mt-3 text-sm rounded-lg border p-2 bg-emerald-50 text-emerald-800">
          ✅ {result.message} (studies in DB: {result.studiesCount})
        </div>
      )}
      {error && (
        <div className="mt-3 text-sm rounded-lg border p-2 bg-rose-50 text-rose-800">
          ❌ {error}
        </div>
      )}
    </Card>
  );
}
