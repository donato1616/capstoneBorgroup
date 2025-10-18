// frontend/src/pages/admin/Predictive.jsx
import { useEffect, useState } from 'react';
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5050';

export default function Predictive({ selectedDataset }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!selectedDataset) return;
    setData(null); setErr('');
    fetch(`${API_BASE}/api/dataset/${selectedDataset}/predictive`)
      .then(r => { if(!r.ok) throw new Error('load failed'); return r.json(); })
      .then(setData)
      .catch(e => setErr(e.message));
  }, [selectedDataset]);

  if (!selectedDataset) return <div>Select a dataset</div>;
  if (err) return <div className="text-red-500">{err}</div>;
  if (!data) return <div>Loading…</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Box title="Linear Regression">
        <div className="text-sm">Slope: <b>{data.model?.slope?.toFixed?.(3) ?? '—'}</b></div>
        <div className="text-sm">R²: <b>{data.model?.r2?.toFixed?.(2) ?? '—'}</b></div>
      </Box>
      <Box title="Time-Series Forecast">
        <ul className="text-sm">
          {data.forecast.map(f => <li key={f.d}>{f.d}: {f.c}</li>)}
        </ul>
      </Box>
    </div>
  );
}

const Box = ({ title, children }) => (
  <div className="card p-4 min-h-[220px]">
    <div className="text-sm font-medium mb-3">{title}</div>
    <div className="text-xs text-zinc-700">{children}</div>
  </div>
);
