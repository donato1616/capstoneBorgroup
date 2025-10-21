// frontend/src/pages/admin/Predictive.jsx
import { useEffect, useState, useMemo } from 'react';
import DatasetSelector from '../../components/DatasetSelector';
import { Card } from '../../components/ui';
import LineTimeseries from '../../components/charts/LineTimeseries';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5050';

export default function PredictiveInsights() {
  const [datasetId, setDatasetId] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!datasetId) { setData(null); return; }
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/dataset/${datasetId}/predict/regression`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json());
      } catch (e) {
        console.error(e);
        setData(null);
      }
    })();
  }, [datasetId]);

  const r2 = data?.metrics?.r2 ?? 0;
  const mse = data?.metrics?.mse ?? 0;
  const mape = data?.metrics?.mape;

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

  const hasTime = (historySeries[0]?.data?.length || 0) > 1;

  return (
    <div className="space-y-4">
      <DatasetSelector onSelectDataset={setDatasetId} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4"><div className="text-xs text-zinc-500">R²</div><div className="text-2xl font-semibold mt-1">{r2.toFixed(3)}</div></Card>
        <Card className="p-4"><div className="text-xs text-zinc-500">MSE</div><div className="text-2xl font-semibold mt-1">{mse.toFixed(3)}</div></Card>
        <Card className="p-4"><div className="text-xs text-zinc-500">MAPE</div><div className="text-2xl font-semibold mt-1">{mape == null ? '—' : `${(mape*100).toFixed(1)}%`}</div></Card>
      </div>

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">7-Day Forecast</div>
        {!hasTime
          ? <div className="text-sm text-zinc-500">Insufficient dated history to fit a model.</div>
          : <LineTimeseries series={[...historySeries, ...forecastSeries]} />
        }
      </Card>
    </div>
  );
}