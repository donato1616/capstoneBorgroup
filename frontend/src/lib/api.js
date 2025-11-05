// src/lib/api.js
export const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/+$/, '') || 'http://localhost:5050';

// Function to fetch datasets with credentials
export async function fetchDatasets() {
  const res = await fetch(`${API_BASE}/api/datasets`, {
    credentials: 'include',  // Ensure cookies and credentials are sent
    method: 'GET',
  });
  if (!res.ok) throw new Error('Failed to fetch datasets');
  return res.json(); // Assuming it returns [{ dataset_id, name, ... }]
}

// Function to fetch audit log data
export async function fetchAuditLog({ datasetId = '', actor = '', action = '', from = '', to = '', limit = 50, offset = 0 }) {
  const qs = new URLSearchParams({ datasetId, actor, action, from, to, limit, offset });
  const res = await fetch(`${API_BASE}/api/audit?${qs.toString()}`, {
    credentials: 'include',  // Ensure cookies and credentials are sent
    method: 'GET',
  });
  if (!res.ok) throw new Error('Failed to fetch audit log');
  return res.json();
}

// Function to fetch analytics data
export async function fetchAnalytics(datasetId) {
  if (!datasetId) return { descriptive: null, predictive: null, prescriptive: null };
  const res = await fetch(`${API_BASE}/api/datasets/${datasetId}/analytics`, {
    credentials: 'include',  // Ensure cookies and credentials are sent
    method: 'GET',
  });
  if (!res.ok) throw new Error('Failed to fetch analytics');
  return res.json(); // Returns { descriptive, predictive, prescriptive }
}

// Function to recompute descriptive analytics
export async function recomputeDescriptive(datasetId) {
  const res = await fetch(`${API_BASE}/api/datasets/${datasetId}/analytics/recompute`, {
    method: 'POST',
    credentials: 'include',  // Ensure cookies and credentials are sent
  });
  if (!res.ok) throw new Error('Failed to recompute descriptive analytics');
  return res.json(); // Returns { ok: true }
}
