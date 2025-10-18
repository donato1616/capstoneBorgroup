export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5050';

async function get(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load summary');
  return res.json();
}

export const listDatasets = () => get(`${API_BASE}/api/dataset`);
export const fetchAnalytics = (id) => get(`${API_BASE}/api/dataset/${id}/analytics`);
export const fetchDatasetSummary = (id) => get(`${API_BASE}/api/dataset/${id}/summary`);
export const fetchQDist = (id, q) => get(`${API_BASE}/api/dataset/${id}/qdist?questionCode=${encodeURIComponent(q)}`);
export const fetchCompletion = (id) => get(`${API_BASE}/api/dataset/${id}/completion`);
export const fetchPredictive = (id) => get(`${API_BASE}/api/dataset/${id}/predictive`);
export const fetchAudit = (id) => get(`${API_BASE}/api/dataset/${id}/audit`);
