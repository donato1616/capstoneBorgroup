// frontend/src/api/index.js
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5050';

export async function fetchDatasets() {
  const r = await fetch(`${API_BASE}/api/dataset`, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function fetchDatasetSummary(datasetId) {
  const r = await fetch(`${API_BASE}/api/dataset/${datasetId}/summary`);
  if (!r.ok) throw new Error('Failed to load summary');
  return r.json();
}

export async function fetchQDist(datasetId, questionCode) {
  const url = `${API_BASE}/api/dataset/${datasetId}/qdist?questionCode=${encodeURIComponent(questionCode)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Failed to load distribution');
  return r.json();
}
