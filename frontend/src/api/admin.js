// src/api/admin.js
import { API_BASE } from "../lib/api";

export async function getAuditFacets() {
  const res = await fetch(`${API_BASE}/api/audit/facets`, { credentials: "include" });
  if (!res.ok) throw new Error("audit facets failed");
  return res.json(); // {actors:[{actor}], actions:[{action}], datasets:[{dataset_id,name}]}
}

export async function getAuditLog({ datasetId = "", actor = "", action = "", from = "", to = "", limit = 50, offset = 0 }) {
  const qs = new URLSearchParams({ datasetId, actor, action, from, to, limit, offset });
  const res = await fetch(`${API_BASE}/api/audit?${qs.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error("audit list failed");
  return res.json(); // {total, items:[...]}
}

export async function getAnalytics(datasetId) {
  if (!datasetId) return { descriptive: null, predictive: null, prescriptive: null };
  const res = await fetch(`${API_BASE}/api/datasets/${datasetId}/analytics`, { credentials: "include" });
  if (!res.ok) throw new Error("analytics failed");
  return res.json();
}

export async function recomputeDescriptive(datasetId) {
  const res = await fetch(`${API_BASE}/api/datasets/${datasetId}/analytics/recompute`, {
    method: "POST", credentials: "include"
  });
  if (!res.ok) throw new Error("recompute failed");
  return res.json();
}
