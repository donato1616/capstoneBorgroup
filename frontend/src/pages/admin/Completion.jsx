// frontend/src/pages/admin/Completion.jsx
import { useEffect, useState } from 'react';
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5050';

export default function Completion({ selectedDataset }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!selectedDataset) return;
    setData(null); setErr('');
    fetch(`${API_BASE}/api/dataset/${selectedDataset}/completion`)
      .then(r => { if(!r.ok) throw new Error('load failed'); return r.json(); })
      .then(setData)
      .catch(e => setErr(e.message));
  }, [selectedDataset]);

  if (!selectedDataset) return <div>Select a dataset</div>;
  if (err) return <div className="text-red-500">{err}</div>;
  if (!data) return <div>Loading…</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Box title="Completion Progress Over Time">
        <pre className="text-xs">{JSON.stringify(data.daily.slice(-14),null,2)}</pre>
      </Box>
      <Box title="By Location">
        <ul className="text-sm">{data.by_region.map(r => <li key={r.region}>{r.region}: {r.c}</li>)}</ul>
      </Box>
      <Box title="By Field Researcher">
        <ul className="text-sm">{data.by_interviewer.map(r => <li key={r.interviewer}>{r.interviewer}: {r.c}</li>)}</ul>
      </Box>
    </div>
  );
}

const Box = ({ title, children }) => (
  <div className="card p-4 min-h-[260px]">
    <div className="text-sm font-medium mb-3">{title}</div>
    <div className="text-xs text-zinc-700">{children}</div>
  </div>
);
