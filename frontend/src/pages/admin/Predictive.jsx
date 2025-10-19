import { useEffect, useState, useMemo } from 'react';
import DatasetSelector from '../../components/DatasetSelector';
import { Card } from '../../components/ui';
import LineTimeseries from '../../components/charts/LineTimeseries';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5050';

export default function PredictiveInsights() {
  const [datasetId, setDatasetId] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  useEffect(() => {
    if (!datasetId) { setData(null); return; }
    (async () => {
      try {
        setErr("");
        const r = await fetchJSON(`${API_BASE}/api/dataset/${datasetId}/forecast`);
        setData(r);
      } catch (e) { console.error(e); setErr("Failed to load forecast."); setData(null); }
    })();
  }, [datasetId]);

  const r2   = data?.metrics?.r2 ?? 0;
  const mse  = data?.metrics?.mse ?? 0;
  const mape = data?.metrics?.mape ?? null;

  const series = useMemo(
    () => (data?.horizon || []).map(h => ({ date: h.date, value: h.projected })),
    [data]
  );

  return (
    <div className="space-y-4">
      <DatasetSelector onSelectDataset={setDatasetId} />
      {err && <div className="chip bg-amber-50 border-amber-300 text-amber-800">{err}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4"><div className="text-xs text-zinc-500">R²</div><div className="text-2xl font-semibold mt-1">{r2.toFixed(3)}</div></Card>
        <Card className="p-4"><div className="text-xs text-zinc-500">MSE</div><div className="text-2xl font-semibold mt-1">{mse.toFixed(3)}</div></Card>
        <Card className="p-4"><div className="text-xs text-zinc-500">MAPE</div><div className="text-2xl font-semibold mt-1">{mape == null ? "—" : `${(mape*100).toFixed(1)}%`}</div></Card>
      </div>

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">7-Day Forecast</div>
        {series.length
          ? <LineTimeseries data={series} xKey="date" yKey="value" yLabel="Projected completes" />
          : <div className="text-sm text-zinc-500">No forecast.</div>}
      </Card>
    </div>
  );
}
