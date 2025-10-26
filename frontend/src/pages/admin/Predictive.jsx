// frontend/src/pages/admin/Predictive.jsx
import { useEffect, useMemo, useState } from 'react';
import DatasetSelector from '../../components/DatasetSelector';
import { Card } from '../../components/ui';
import LineTimeseries from '../../components/charts/LineTimeseries';
import RegressionChart from '../../components/charts/RegressionChart'; // <-- add this file if you haven't yet

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5050';

export default function PredictiveInsights() {
  const [datasetId, setDatasetId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!datasetId) { setData(null); return; }
    (async () => {
      try {
        setLoading(true); setErr('');
        const res = await fetch(`${API_BASE}/api/dataset/${datasetId}/predict/regression`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json());
      } catch (e) {
        console.error(e);
        setErr(e.message || 'Failed to load dataset');
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [datasetId]);

  const unit   = data?.unit || 'respondents/day';
  const r2     = data?.metrics?.r2;
  const mse    = data?.metrics?.mse;
  const rmse   = data?.metrics?.rmse;
  const brmse  = data?.metrics?.baseline_rmse;
  const mape   = data?.metrics?.mape;
  const improv = data?.metrics?.improvement_vs_baseline; // 0–1

  // --- keep your existing series for LineTimeseries ---
  const historySeries = useMemo(() => {
    if (!data?.history?.length) return [];
    return [
      { name: 'Actual',  data: data.history.map(x => ({ date: x.date, value: x.actual })) },
      { name: 'Fitted',  data: data.history.map(x => ({ date: x.date, value: x.fitted })) },
    ];
  }, [data]);

  const forecastSeries = useMemo(() => {
    if (!data?.horizon?.length) return [];
    return [{ name: 'Forecast', data: data.horizon.map(x => ({ date: x.date, value: x.projected })) }];
  }, [data]);

  const hasTime = ((historySeries[0]?.data?.length || 0) > 1) || (forecastSeries[0]?.data?.length || 0) > 0;

  const fmt = (v, d = 3) => (v == null ? '—' : Number(v).toFixed(d));

  return (
    <div className="space-y-4">
      <DatasetSelector onSelectDataset={setDatasetId} />

      {/* ==== KPIs (extended, but keeps your originals) ==== */}
      <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
        <Card className="p-4">
          <div className="text-xs text-zinc-500">R²</div>
          <div className="text-2xl font-semibold mt-1">{fmt(r2)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">MSE</div>
          <div className="text-2xl font-semibold mt-1">{fmt(mse)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">RMSE ({unit})</div>
          <div className="text-2xl font-semibold mt-1">{fmt(rmse)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">Baseline RMSE ({unit})</div>
          <div className="text-2xl font-semibold mt-1">{fmt(brmse)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">Improvement vs Baseline</div>
          <div className="text-2xl font-semibold mt-1">
            {improv == null ? '—' : `${(improv * 100).toFixed(1)}%`}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">MAPE</div>
          <div className="text-2xl font-semibold mt-1">
            {mape == null ? '—' : `${(mape * 100).toFixed(1)}%`}
          </div>
        </Card>
      </div>

      {/* ==== Chart A: keep your original LineTimeseries ==== */}
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">7-Day Forecast (Simple)</div>
        {loading && <div className="text-sm text-zinc-500">Computing…</div>}
        {!loading && err && <div className="text-sm text-rose-600">Error: {err}</div>}
        {!loading && !err && !hasTime
          ? <div className="text-sm text-zinc-500">Insufficient dated history to fit a model.</div>
          : <LineTimeseries series={[...historySeries, ...forecastSeries]} />
        }
      </Card>

      {/* ==== Chart B: new detailed regression chart with baseline line ==== */}
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">7-Day Forecast (Detailed with Baseline)</div>
        {loading && <div className="text-sm text-zinc-500">Computing…</div>}
        {!loading && err && <div className="text-sm text-rose-600">Error: {err}</div>}
        {!loading && !err && hasTime && (
          <RegressionChart
            history={data?.history || []}
            horizon={data?.horizon || []}
            unit={unit}
          />
        )}
        {!loading && !err && !hasTime && (
          <div className="text-sm text-zinc-500">Insufficient dated history to fit a model.</div>
        )}
      </Card>

      <Card className="p-4">
    <div className="text-xs text-zinc-500">OOS RMSE ({unit})</div>
    <div className="text-2xl font-semibold mt-1">{fmt(data?.metrics?.oos_rmse)}</div>
  </Card>
  <Card className="p-4">
    <div className="text-xs text-zinc-500">OOS R²</div>
    <div className="text-2xl font-semibold mt-1">{fmt(data?.metrics?.oos_r2)}</div>
  </Card>
    </div>
  );
}
