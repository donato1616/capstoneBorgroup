// frontend/src/pages/admin/Overview.jsx
import { useEffect, useState, useMemo } from "react";
import { Card, KPI, Filter } from "../../components/ui";
import UploadData from "../../components/UploadData";
import LineTimeseries from "../../components/charts/LineTimeseries";
import BarBins from "../../components/charts/BarBins";
import BarTop from "../../components/charts/BarTop";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5050";
const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString());

export default function Overview({ selectedDataset }) {
  const [summary, setSummary] = useState(null);
  const [series, setSeries] = useState([]);
  const [qcode, setQcode] = useState("");
  const [qdist, setQdist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // helpers
  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // load summary + daily series
  useEffect(() => {
    if (!selectedDataset) { setSummary(null); setSeries([]); setQcode(""); setQdist(null); return; }
    (async () => {
      try {
        setLoading(true); setErr("");
        const [s, ser] = await Promise.all([
          fetchJson(`${API_BASE}/api/dataset/${selectedDataset}/summary`),
          fetchJson(`${API_BASE}/api/dataset/${selectedDataset}/series`)
        ]);
        setSummary(s);
        setSeries((ser?.daily || []).map(r => ({ date: String(r.day), value: Number(r.respondents || 0) })));
        // preselect most common question
        const topQ = (s?.top_questions || [])[0]?.question;
        setQcode(topQ || "");
      } catch (e) {
        console.error(e);
        setErr("Failed to load summary");
        setSummary(null); setSeries([]); setQcode(""); setQdist(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedDataset]);

  // load distribution for selected question
  useEffect(() => {
    if (!selectedDataset || !qcode) { setQdist(null); return; }
    (async () => {
      try {
        const j = await fetchJson(`${API_BASE}/api/dataset/${selectedDataset}/qdist?questionCode=${encodeURIComponent(qcode)}`);
        setQdist(j);
      } catch (e) {
        console.error(e);
        setQdist(null);
      }
    })();
  }, [selectedDataset, qcode]);

  const regionTop = summary?.by_region?.slice(0, 5) ?? [];
  const totalResp = summary?.respondent_count ?? null;
  const factCount = summary?.fact_count ?? null;
  const questions = summary?.top_questions || [];

  // chart data
  const dailyData = useMemo(() => series, [series]);

  return (
    <div className="space-y-6">
      {err && <div className="chip bg-amber-50 border-amber-300 text-amber-800">{err}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <Filter label="Client" /><Filter label="Project" />
        <Filter label="Survey" /><Filter label="Date Range" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPI label="Respondents" value={loading ? "…" : fmt(totalResp)} />
        <KPI label="Facts Indexed" value={loading ? "…" : fmt(factCount)} sub="Long-form Q/A facts" />
        <KPI label="Top Region" value={regionTop[0]?.region || "N/A"} sub={regionTop[0] ? `${fmt(regionTop[0].c)} facts` : ""} />
      </div>

      {/* Daily submissions line chart */}
      <Card className="p-4">
        <div className="text-sm font-medium mb-3">Daily Submissions</div>
        {dailyData.length ? (
          <LineTimeseries data={dailyData} xKey="date" yKey="value" />
        ) : (
          <div className="text-sm text-zinc-500">No dated submissions found.</div>
        )}
      </Card>

      {/* Regions */}
      <div className="rounded-xl border p-4">
        <div className="text-sm font-medium">Regions, top 5</div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-3">
          {regionTop.length === 0 && <div className="text-sm text-zinc-500">No region data.</div>}
          {regionTop.map(r => (
            <div key={r.region} className="rounded-lg border p-3">
              <div className="text-xs text-zinc-500 truncate">{r.region}</div>
              <div className="text-lg font-semibold">{fmt(r.c)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Question distribution (numeric + text) */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-sm font-medium">Question Distribution</div>
          <select
            className="border rounded-lg px-2 py-1 text-sm"
            value={qcode}
            onChange={(e) => setQcode(e.target.value)}
          >
            {questions.map((q) => (
              <option key={q.question} value={q.question}>{q.question} ({q.c})</option>
            ))}
          </select>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-zinc-500 mb-2">Numeric bins</div>
            {qdist?.numeric_bins?.length ? (
              <BarBins bins={qdist.numeric_bins} />
            ) : (
              <div className="text-sm text-zinc-500">No numeric data.</div>
            )}
          </div>

          <div>
            <div className="text-xs text-zinc-500 mb-2">Top text answers</div>
            {qdist?.text_top?.length ? (
              <BarTop items={qdist.text_top.map(t => ({ label: t.label, count: t.count }))} />
            ) : (
              <div className="text-sm text-zinc-500">No text data.</div>
            )}
          </div>
        </div>
      </Card>

      {/* Upload (bottom) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <UploadData />
      </div>
    </div>
  );
}
