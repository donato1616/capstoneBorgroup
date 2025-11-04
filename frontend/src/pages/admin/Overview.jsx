// frontend/src/pages/admin/Overview.jsx
import { useEffect, useMemo, useState } from "react";
import { Card, KPI, Filter } from "../../components/ui";
import UploadData from "../../components/UploadData";
import BarSimple from "../../components/charts/BarSimple";
import HistoNumeric from "../../components/charts/HistoNumeric";
import BarTopText from "../../components/charts/BarTopText";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5050";
const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString());

const fmtPct = (n, digits = 2) =>
  n === null || n === undefined ? "—" : `${Number(n).toFixed(digits)}%`;

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export default function Overview({ selectedDataset }) {
  const [summary, setSummary] = useState(null);
  const [regionCompleted, setRegionCompleted] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [qCode, setQCode] = useState("");
  const [qDist, setQDist] = useState({ numeric_bins: [], text_top: [] });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [metrics, setMetrics] = useState(null); // added state

  // load summary + regions + question list
  useEffect(() => {
    if (!selectedDataset) {
      setSummary(null);
      setRegionCompleted([]);
      setQuestions([]);
      setQCode("");
      setQDist({ numeric_bins: [], text_top: [] });
      setMetrics(null);
      return;
    }

    (async () => {
      setLoading(true); setErr("");
      const urls = {
        summary:     `${API_BASE}/api/dataset/${selectedDataset}/summary`,
        byRegion:    `${API_BASE}/api/dataset/${selectedDataset}/by-region-completed`,
        questions:   `${API_BASE}/api/dataset/${selectedDataset}/questions`,
        // served by backend (server.js must have: app.use('/data', express.static(path.join(process.cwd(),'backend','data')))
        metricsJson: `${API_BASE}/data/clean/metrics.json`,
      };

      const [rSummary, rRegion, rQs, rMetrics] = await Promise.allSettled([
        fetchJson(urls.summary),
        fetchJson(urls.byRegion),
        fetchJson(urls.questions),
        fetchJson(urls.metricsJson),
      ]);

      // metrics.json should not be blocked by other failures
      if (rMetrics.status === "fulfilled") setMetrics(rMetrics.value);
      else setMetrics(null); // still render the rest

      if (rSummary.status === "fulfilled") {
        setSummary(rSummary.value);
      } else {
        setSummary(null);
        setErr("Failed to load summary"); // but don't bail out
      }

      if (rRegion.status === "fulfilled") {
        setRegionCompleted((rRegion.value.items || []).map(r => ({ label: r.region, value: r.completed })));
      } else {
        setRegionCompleted([]);
      }

      if (rQs.status === "fulfilled") {
        const s = rSummary.status === "fulfilled" ? rSummary.value : {};
        const qs = (rQs.value.items?.length ? rQs.value.items : s.top_questions || []).map(x => x.question ? x : { question: x });
        setQuestions(qs);
        setQCode(qs?.[0]?.question || "");
      } else {
        setQuestions([]); setQCode("");
      }

      setLoading(false);
    })();
  }, [selectedDataset]);

  // load distribution when qCode changes
  useEffect(() => {
    if (!selectedDataset || !qCode) { setQDist({ numeric_bins: [], text_top: [] }); return; }
    (async () => {
      try {
        const d = await fetchJson(`${API_BASE}/api/dataset/${selectedDataset}/qdist?questionCode=${encodeURIComponent(qCode)}`);
        setQDist(d);
      } catch (e) {
        console.error(e);
        setQDist({ numeric_bins: [], text_top: [] });
      }
    })();
  }, [selectedDataset, qCode]);

  const totalResp = summary?.respondent_count ?? null;
  const factCount = summary?.fact_count ?? null;
  const topRegion = (summary?.by_region_facts || [])[0];
  const completedPct = summary ? Math.round(summary.completed_pct || 0) : null;

  // derived from metrics.json (if available)
  const totalResponses = metrics?.rows_completed ?? null;              // completed sessions
  const completedRate = metrics?.completion_rate_pct ?? null;         // optional subtext
  const generatedAt = metrics?.generated_at ? new Date(metrics.generated_at).toLocaleString() : null;

  // --- metrics.json based values ---
  const completionPctFromMetrics =
    metrics?.completion_rate_pct !== undefined && metrics?.completion_rate_pct !== null
      ? Number(metrics.completion_rate_pct)
      : null;

  const metricsUpdatedAt = metrics?.generated_at
    ? new Date(metrics.generated_at).toLocaleString()
    : null;

  // prefer metrics values when present; fallback to summary
  const respondentsValue = totalResponses ?? totalResp;
  const respondentsSub =
    completedRate != null
      ? `${Number(completedRate).toLocaleString()}%`
      : (generatedAt ? `Updated ${generatedAt}` : (completedPct === null ? "" : `${completedPct}%`));

  async function deleteDataset() {
    if (!selectedDataset) return;
    const yes = window.confirm("Delete this dataset (facts & audit)? This cannot be undone.");
    if (!yes) return;
    try {
      const r = await fetch(`${API_BASE}/api/dataset/${selectedDataset}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      window.location.reload();
    } catch (e) {
      alert("Delete failed: " + e.message);
    }
  }

  const topRegionComputed = useMemo(() => {
    if (!regionCompleted || regionCompleted.length === 0) return null;
    return regionCompleted.reduce((best, r) =>
      (r.value > (best?.value ?? -Infinity) ? r : best), null);
  }, [regionCompleted]);

  return (
    <div className="space-y-6">
      {err && <div className="chip bg-amber-50 border-amber-300 text-amber-800">{err}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <Filter label="Client" /><Filter label="Project" />
        <Filter label="Survey" /><Filter label="Date Range" />
        <div className="ml-auto">
          <button
            onClick={deleteDataset}
            className="text-sm border rounded px-3 py-1 hover:bg-red-50 hover:border-red-300"
            disabled={!selectedDataset}
            title="Delete dataset"
          >
            Delete dataset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
        <KPI
          label="Total Responses"
          value={loading && !metrics ? "…" : fmt(totalResponses)}
          sub={
            completedRate != null
              ? `${Number(completedRate).toFixed(2)}% • ${generatedAt || ""}`
              : (generatedAt ? `Updated ${generatedAt}` : "")
          }
        />
        <KPI label="Respondents" value={loading ? "…" : fmt(summary?.respondent_count ?? null)} />
        <KPI label="Facts Indexed" value={loading ? "…" : fmt(summary?.fact_count ?? null)} sub="Long-form Q/A facts" />
        <KPI
          label="Top Region"
          value={topRegionComputed ? topRegionComputed.label : "Unspecified"}
          sub={topRegionComputed ? `${fmt(topRegionComputed.value)} completed` : ""}
        />
        <KPI
          label="Completed %"
          value={
            completionPctFromMetrics !== null
              ? fmtPct(completionPctFromMetrics, 2)
              : (summary ? fmtPct(Math.round(summary.completed_pct || 0), 0) : "—")
          }
          sub={
            completionPctFromMetrics !== null
              ? (metricsUpdatedAt ? `from metrics.json • ${metricsUpdatedAt}` : `from metrics.json`)
              : "(dated or dense)"
          }
        />
      </div>

      {/* Question Distribution */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Question Distribution</div>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={qCode}
            onChange={(e) => setQCode(e.target.value)}
          >
            {(questions || []).map(q => (
              <option key={q.question} value={q.question}>
                {q.question}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4"><HistoNumeric bins={qDist.numeric_bins} /></Card>
          <Card className="p-4"><BarTopText items={qDist.text_top} /></Card>
        </div>
      </Card>

      {/* Completed by Region */}
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Survey completed by region</div>
        {regionCompleted.length === 0
          ? <div className="text-sm text-zinc-500">No region data / no dated interviews.</div>
          : <BarSimple data={regionCompleted} xKey="label" yKey="value" height={260} />
        }
      </Card>

      {/* Upload Data (bottom) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <UploadData />
      </div>
    </div>
  );
}