
import React, { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5050';

export default function DatasetSelector({ onSelectDataset }) {
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError('');

        let data;
        // Preferred new route
        try {
          data = await fetchJson(`${API_BASE}/api/dataset`);
        } catch {
          // Fallback to any legacy /api/datasets you still have
          data = await fetchJson(`${API_BASE}/api/datasets`);
        }

        const norm = (Array.isArray(data) ? data : []).map(d => ({
          dataset_id: d.dataset_id ?? d.id,
          name: d.name ?? `Dataset ${d.dataset_id ?? d.id}`
        })).filter(d => d.dataset_id);

        if (norm.length) {
          setDatasets(norm);
          setSelectedDataset(String(norm[0].dataset_id));
          onSelectDataset(String(norm[0].dataset_id));
        } else {
          setDatasets([]);
          setError('No datasets found');
        }
      } catch (err) {
        console.error('Error fetching datasets:', err);
        setError('Failed to load datasets');
        setDatasets([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [onSelectDataset]);

  const handleChange = (e) => {
    const id = e.target.value;
    setSelectedDataset(id);
    onSelectDataset(id);
  };

  return (
    <div>
      <label htmlFor="dataset-select" className="mr-2 font-medium">Select Dataset:</label>
      {loading ? (
        <span className="text-gray-500">Loading datasets...</span>
      ) : error ? (
        <span className="text-red-500">{error}</span>
      ) : (
        <select
          id="dataset-select"
          value={selectedDataset}
          onChange={handleChange}
          className="border rounded px-2 py-1"
        >
          <option value="">-- Choose a dataset --</option>
          {datasets.map(d => (
            <option key={d.dataset_id} value={d.dataset_id}>{d.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
