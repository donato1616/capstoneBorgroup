// frontend/src/pages/admin/Overview.jsx
import { useEffect, useState } from "react";
import { Card, KPI, Filter } from "../../components/ui";
import UploadData from "../../components/UploadData";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5050";
const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString());

export default function Overview({ selectedDataset }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function loadSummary(dsId) {
    const res = await fetch(`${API_BASE}/api/dataset/${dsId}/summary`);
    if (!res.ok) throw new Error("Failed to load summary");
    return res.json();
    // { respondent_count, fact_count, by_region: [{region,c}], top_questions: [{question,c}] }
  }

  useEffect(() => {
    if (!selectedDataset) { setSummary(null); return; }
    (async () => {
      try {
        setLoading(true);
        const s = await loadSummary(selectedDataset);
        setSummary(s);
        setErr("");
      } catch (e) {
        console.error("analytics load failed", e);
        setErr("Failed to load summary");
        setSummary(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedDataset]);

  const regionTop = summary?.by_region?.slice(0, 5) ?? [];
  const totalResp = summary?.respondent_count ?? null;
  const factCount = summary?.fact_count ?? null;

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

      {/* (leave your chart placeholders) */}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <UploadData />
      </div>
    </div>
  );
}
