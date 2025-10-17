const API = 'http://localhost:5050';

export async function fetchDatasets() {
  const res = await fetch(`${API}/api/datasets`, { credentials: 'include' });
  return res.json(); // [{ dataset_id, name, open_issues, ... }]
}

export async function fetchFlaggedRows(datasetId, limit=50, offset=0) {
  const res = await fetch(`${API}/api/datasets/${datasetId}/rows?status=flagged&limit=${limit}&offset=${offset}`, { credentials: 'include' });
  return res.json(); // [{ raw_row_id, row_idx, data, issues: [...] }]
}

export async function fetchCleanRows(datasetId, limit=50, offset=0) {
  const res = await fetch(`${API}/api/datasets/${datasetId}/rows?status=clean&limit=${limit}&offset=${offset}`, { credentials: 'include' });
  return res.json(); // [{ clean_row_id, business_key, observed_at, ... }]
}

export async function applyFix(datasetId, rawRowId, fixes, actor='admin', note='') {
  const res = await fetch(`${API}/api/datasets/${datasetId}/rows/${rawRowId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ fixes, actor, note })
  });
  return res.json(); // { ok: true }
}

export async function fetchAnalytics(datasetId) {
  const res = await fetch(`${API}/api/datasets/${datasetId}/analytics`, { credentials: 'include' });
  return res.json(); // { descriptive, predictive, prescriptive }
}

export async function recomputeDescriptive(datasetId) {
  const res = await fetch(`${API}/api/datasets/${datasetId}/analytics/recompute`, {
    method: 'POST', credentials: 'include'
  });
  return res.json(); // { ok: true }
}