import { useEffect, useMemo, useState } from "react";
import DatasetSelector from "../../components/DatasetSelector";
import { Card } from "../../components/ui";
import LineTimeseries from "../../components/charts/LineTimeseries";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5050";

export default function Completion() {
  const [datasetId, setDatasetId] = useState("");
  const [daily, setDaily] = useState([]);
  const [byRegion, setByRegion] = useState([]);
  const [byInterviewer, setByInterviewer] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  useEffect(() => {
    if (!datasetId) {
      setDaily([]);
      setByRegion([]);
      setByInterviewer([]);
      return;
    }
    
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const [d1, d2, d3] = await Promise.all([
          fetchJSON(`${API_BASE}/api/dataset/${datasetId}/completion/daily`),
          fetchJSON(`${API_BASE}/api/dataset/${datasetId}/completion/by-region`),
          fetchJSON(`${API_BASE}/api/dataset/${datasetId}/completion/by-interviewer`)
        ]);
        
        console.log("Daily completion data:", d1); // Debug log
        
        // Transform the data to ensure proper format
        const dailyData = (d1.items || []).map(r => ({ 
          date: String(r.d).slice(0,10), 
          value: r.cnt 
        }));
        
        setDaily(dailyData);
        setByRegion(d2.items || []);
        setByInterviewer(d3.items || []);
      } catch (e) {
        console.error("Completion data error:", e); 
        setErr("Failed to load completion analytics.");
      } finally {
        setLoading(false);
      }
    })();
  }, [datasetId]);

  const total = useMemo(() => (daily||[]).reduce((s,r)=>s + (r.value||0), 0), [daily]);

  return (
    <div className="space-y-6">
      <DatasetSelector onSelectDataset={setDatasetId} />
      {!datasetId && <div className="p-4 text-sm text-zinc-600">Select a dataset</div>}
      {err && <div className="chip bg-amber-50 border-amber-300 text-amber-800">{err}</div>}
      {loading && <div className="p-4 text-sm text-zinc-600">Loading completion data...</div>}

      {datasetId && (
        <>
          <Card className="p-4">
            <div className="text-sm font-medium mb-3">Completion Progress Over Time</div>
            {daily.length ? (
              <>
                <LineTimeseries 
                  data={daily} 
                  xKey="date" 
                  yKey="value" 
                  yLabel="Completed" 
                  seriesName="Completed"
                />
                <div className="mt-3 text-sm text-zinc-700">
                  Total completed interviews: <b>{total}</b>
                </div>
                
              </>
            ) : (
              <div className="text-sm text-zinc-500">
                {loading ? "Loading..." : "No dated completions found."}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="text-sm font-medium mb-3">By Location</div>
              <table className="w-full text-sm">
                <thead className="text-left text-zinc-500">
                  <tr><th className="p-2">Region</th><th className="p-2">Completed</th></tr>
                </thead>
                <tbody>
                  {(byRegion||[]).map(r=>(
                    <tr key={r.region} className="border-b">
                      <td className="p-2">{r.region}</td>
                      <td className="p-2">{r.cnt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card className="p-4">
              <div className="text-sm font-medium mb-3">By Field Researcher</div>
              <table className="w-full text-sm">
                <thead className="text-left text-zinc-500">
                  <tr><th className="p-2">Interviewer</th><th className="p-2">Completed</th></tr>
                </thead>
                <tbody>
                  {(byInterviewer||[]).map(r=>(
                    <tr key={r.interviewer} className="border-b">
                      <td className="p-2">{r.interviewer}</td>
                      <td className="p-2">{r.cnt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}