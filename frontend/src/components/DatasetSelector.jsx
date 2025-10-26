import React, { useEffect, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5050';

export default function DatasetSelector({ onSelectDataset }) {
  const [datasets, setDatasets] = useState([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  useEffect(() => {
    const run = async () => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        setLoading(true);
        setError('');

        // prefer /api/dataset, fallback to /api/datasets
        let res = await fetch(`${API_BASE}/api/dataset`, { signal: ctrl.signal });
        if (!res.ok) res = await fetch(`${API_BASE}/api/datasets`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const raw = await res.json();
        const norm = (Array.isArray(raw) ? raw : []).map(d => ({
          dataset_id: d.dataset_id ?? d.id,
          name: d.name ?? `Dataset ${d.dataset_id ?? d.id}`
        })).filter(d => d.dataset_id);

        setDatasets(norm);
        const first = String(norm[0]?.dataset_id || '');
        setSelected(first);
        if (first) onSelectDataset(first);
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.error('datasets load failed', e);
        setError('Failed to load datasets');
        setDatasets([]);
        setSelected('');
        onSelectDataset('');
      } finally {
        setLoading(false);
      }
    };

    run();
    return () => abortRef.current?.abort();
  }, [onSelectDataset]);

  const change = (e) => {
    const id = e.target.value;
    setSelected(id);
    onSelectDataset(id);
  };

  return (
    <div className="my-4 flex gap-4">
      <label htmlFor="ds" className="font-medium">Select Dataset:</label>
      {loading ? (
        <span className="text-gray-500">Loading…</span>
      ) : error ? (
        <span className="text-red-500">{error}</span>
      ) : (
        <select id="ds" value={selected} onChange={change} className="border rounded px-2 py-1">
          {datasets.length === 0 && <option value="">— No datasets —</option>}
          {datasets.map(d => (
            <option key={d.dataset_id} value={d.dataset_id}>{d.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
