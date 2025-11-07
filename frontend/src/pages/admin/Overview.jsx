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

// --- ARCHIVE helpers (client-side localStorage) ---
const ARCHIVE_KEY = "archivedDatasets_v1";
function loadArchived() {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveArchived(list) {
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list || []));
  } catch {}
}
function isArchived(datasetId) {
  if (!datasetId) return false;
  return loadArchived().some(a => a.dataset_id === datasetId);
}
function archiveItem(datasetId, name) {
  const list = loadArchived();
  if (list.some(a => a.dataset_id === datasetId)) return list;
  list.unshift({ dataset_id: datasetId, name: name ?? datasetId, archived_at: new Date().toISOString() });
  saveArchived(list);
  return list;
}
function unarchiveItem(datasetId) {
  const list = loadArchived().filter(a => a.dataset_id !== datasetId);
  saveArchived(list);
  return list;
}

export default function Overview({ selectedDataset }) {
  const [summary, setSummary] = useState(null);
  const [regionCompleted, setRegionCompleted] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [qCode, setQCode] = useState("");
  const [qDist, setQDist] = useState({ numeric_bins: [], text_top: [] });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // new tab state for Archive view
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "archive"
  const [archivedList, setArchivedList] = useState(loadArchived());

  // keep archivedList in sync with localStorage (in case user toggles elsewhere)
  useEffect(() => {
    setArchivedList(loadArchived());
  }, []);

  // load summary + regions + question list
  useEffect(() => {
    if (!selectedDataset) {
      setSummary(null); setRegionCompleted([]); setQuestions([]); setQCode(""); setQDist({ numeric_bins: [], text_top: [] });
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

        const qs = (q.items?.length ? q.items : s.top_questions || []).map(x => x.question ? x : { question: x });
        setQuestions(qs);
        setQCode(qs?.[0]?.question || "");

      } catch (e) {
        console.error("overview load failed", e);
        setErr("Failed to load summary");
        setSummary(null); setRegionCompleted([]); setQuestions([]); setQCode(""); setQDist({ numeric_bins: [], text_top: [] });
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

  async function archiveDataset() {
    if (!selectedDataset) return;
    const yes = window.confirm("Archive this dataset? Archived datasets are hidden from active lists. You can unarchive later.");
    if (!yes) return;
    try {
      // try to get a friendly name from summary endpoint (best-effort)
      let name = selectedDataset;
      try {
        const s = await fetchJson(`${API_BASE}/api/dataset/${selectedDataset}/summary`);
        name = s?.name ?? s?.dataset_id ?? selectedDataset;
      } catch {
        // ignore - fallback to id
      }

      archiveItem(selectedDataset, name);
      setArchivedList(loadArchived());

      // if currently viewing overview for that dataset, switch to archive tab or clear selection
      setActiveTab("archive");
      alert(`Dataset "${name}" archived locally.`);
    } catch (e) {
      console.error("archive failed", e);
      alert("Archive failed: " + (e.message || e));
    }
  }

  function handleUnarchive(id) {
    unarchiveItem(id);
    setArchivedList(loadArchived());
    alert(`Restored ${id}`);
  }
  function handleRemoveFromArchive(id) {
    if (!window.confirm("Remove this archived record from local archive? This only affects local archived list.")) return;
    unarchiveItem(id);
    setArchivedList(loadArchived());
  }

  // Function to generate gradient based on index
  const generateBarColor = (index, total) => {
    const greenStart = 0; // Starting point of green color
    const greenEnd = 255; // Ending point of green color
    const colorValue = Math.floor(greenStart + (greenEnd - greenStart) * (index / total));
    return `rgb(${colorValue}, ${255 - colorValue}, ${colorValue})`;
  };

  const archivedState = isArchived(selectedDataset);

  return (
    <div className="space-y-6">
      {err && <div className="chip bg-amber-50 border-amber-300 text-amber-800">{err}</div>}

      {/* Tabs */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-1 rounded ${activeTab === "overview" ? "border bg-white" : "text-zinc-500"}`}
          >Overview</button>
          <button
            onClick={() => setActiveTab("archive")}
            className={`px-3 py-1 rounded ${activeTab === "archive" ? "border bg-white" : "text-zinc-500"}`}
          >Archived</button>
        </div>

        {/* Filters + archive button - aligned right */}
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <Filter label="Client" /><Filter label="Project" />
          <Filter label="Survey" /><Filter label="Date Range" />
          <div>
            <button
              onClick={archiveDataset}
              className="text-sm border rounded px-3 py-1 hover:bg-amber-50 hover:border-amber-300"
              disabled={!selectedDataset || archivedState}
              title={archivedState ? "Dataset already archived" : "Archive dataset"}
            >
              {archivedState ? "Archived" : "Archive dataset"}
            </button>
          </div>
        </div>
      </div>

      {/* Active Overview */}
      {activeTab === "overview" && (
        <>
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
              : <BarSimple
                  data={regionCompleted}
                  xKey="label"
                  yKey="value"
                  height={260}
                  barColor={(index) => generateBarColor(index, regionCompleted.length)} // Apply gradient color to each bar
                />
            }
          </Card>

          {/* Upload Data */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <UploadData />
          </div>
        </>
      )}

      {/* Archive Tab */}
      {activeTab === "archive" && (
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Archived Datasets (local)</div>
          {archivedList.length === 0 ? (
            <div className="text-sm text-zinc-500">No archived datasets</div>
          ) : (
            <div className="space-y-2">
              {archivedList.map(a => (
                <div key={a.dataset_id} className="flex items-center justify-between border rounded p-2">
                  <div>
                    <div className="font-medium">{a.name ?? a.dataset_id}</div>
                    <div className="text-xs text-zinc-500">id: {a.dataset_id} • archived: {new Date(a.archived_at).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="border rounded px-2 py-1 text-sm"
                      onClick={() => handleUnarchive(a.dataset_id)}
                    >Unarchive</button>
                    <button
                      className="border rounded px-2 py-1 text-sm text-red-600"
                      onClick={() => handleRemoveFromArchive(a.dataset_id)}
                    >Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}