// frontend/src/pages/admin/Overview.jsx
import { useEffect, useMemo, useState } from "react";
import { Card, KPI, Filter } from "../../components/ui";
import UploadData from "../../components/UploadData";
import BarSimple from "../../components/charts/BarSimple";
import HistoNumeric from "../../components/charts/HistoNumeric";
import BarTopText from "../../components/charts/BarTopText";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5050";
const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString());

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

  // load summary + regions + question list
  useEffect(() => {
    if (!selectedDataset) {
      setSummary(null); setRegionCompleted([]); setQuestions([]); setQCode(""); setQDist({numeric_bins:[], text_top:[]});
      return;
    }
    (async () => {
      try {
        setLoading(true); setErr("");
        const [s, reg, q] = await Promise.all([
          fetchJson(`${API_BASE}/api/dataset/${selectedDataset}/summary`),
          fetchJson(`${API_BASE}/api/dataset/${selectedDataset}/by-region-completed`),
          fetchJson(`${API_BASE}/api/dataset/${selectedDataset}/questions`),
        ]);

        setSummary(s);
        setRegionCompleted((reg.items || []).map(r => ({ label: r.region, value: r.completed })));

        const qs = (q.items?.length ? q.items : s.top_questions || []).map(x => x.question ? x : {question: x});
        setQuestions(qs);
        setQCode(qs?.[0]?.question || "");

      } catch (e) {
        console.error("overview load failed", e);
        setErr("Failed to load summary");
        setSummary(null); setRegionCompleted([]); setQuestions([]); setQCode(""); setQDist({numeric_bins:[], text_top:[]});
      } finally {
        setLoading(false);
      }
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

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <KPI label="Respondents" value={loading ? "…" : fmt(totalResp)} />
        <KPI label="Facts Indexed" value={loading ? "…" : fmt(factCount)} sub="Long-form Q/A facts" />
        <KPI label="Top Region" value={topRegion ? topRegion.region : "Unspecified"} sub={topRegion ? `${fmt(topRegion.facts)} facts` : ""} />
        <KPI label="Completed %" value={completedPct === null ? "—" : `${completedPct}%`} sub="(dated or dense)" />
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