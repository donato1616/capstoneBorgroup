// frontend/src/api/index.js
export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

export async function fetchDatasetSummary(datasetId) {
  const r = await fetch(`${API_BASE}/api/dataset/${datasetId}/summary`);
  if (!r.ok) throw new Error('Failed to load summary');
  return r.json();
}

export async function fetchQDist(datasetId, questionCode) {
  const r = await fetch(`${API_BASE}/api/dataset/${datasetId}/qdist?questionCode=${encodeURIComponent(questionCode)}`);
  if (!r.ok) throw new Error('Failed to load qdist');
  return r.json();
}
