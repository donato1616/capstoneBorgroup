// frontend/src/components/DatasetSelector.jsx
import React, { useEffect, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5050';

export default function DatasetSelector({ onSelectDataset }) {
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const ctrlRef = useRef(null);

  const load = async (signal) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/dataset`, { signal });
      if (!res.ok) {
        // Try to read backend error for better debugging
        let detail = '';
        try { const j = await res.json(); detail = j?.detail || ''; } catch {}
        throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
      }
      const data = await res.json();
      const norm = (Array.isArray(data) ? data : [])
        .map(d => ({ dataset_id: d.dataset_id ?? d.id, name: d.name ?? `Dataset ${d.dataset_id ?? d.id}` }))
        .filter(d => d.dataset_id);

      if (norm.length) {
        setDatasets(norm);
        setSelectedDataset(String(norm[0].dataset_id));
        onSelectDataset(String(norm[0].dataset_id));
      } else {
        setDatasets([]);
        setError('No datasets found');
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('datasets load failed', e);
        setError('Failed to load datasets');
        setDatasets([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ctrlRef.current) ctrlRef.current.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    load(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSelectDataset]);

  const retry = () => {
    if (ctrlRef.current) ctrlRef.current.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    load(ctrl.signal);
  };

  return (
    <div className="my-4 flex gap-4 items-center">
      <label htmlFor="dataset-select" className="mr-2 font-medium">Select Dataset:</label>
      {loading ? (
        <span className="text-gray-500">Loading…</span>
      ) : error ? (
        <>
          <span className="text-red-500">{error}</span>
          <button type="button" onClick={retry} className="border rounded px-2 py-1 text-xs">
            Retry
          </button>
        </>
      ) : (
        <select
          id="dataset-select"
          value={selectedDataset}
          onChange={(e) => { setSelectedDataset(e.target.value); onSelectDataset(e.target.value); }}
          className="border rounded px-2 py-1"
        >
          {datasets.map(d => (
            <option key={d.dataset_id} value={d.dataset_id}>{d.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
