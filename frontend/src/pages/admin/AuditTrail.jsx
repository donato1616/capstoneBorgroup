// frontend/src/pages/admin/AuditTrail.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5050";

// --- tiny API helpers local to this file ---
async function getAuditFacets() {
  const res = await fetch(`${API_BASE}/api/audit/facets`, { credentials: "include" });
  if (!res.ok) throw new Error("audit facets failed");
  return res.json(); // {actors:[{actor}], actions:[{action}], datasets:[{dataset_id,name}]}
}

async function getDatasets() {
  const res = await fetch(`${API_BASE}/api/datasets`, { credentials: "include" });
  if (!res.ok) throw new Error("datasets failed");
  return res.json(); // [{dataset_id, name, ...}]
}

async function getAuditLog({ datasetId = "", actor = "", action = "", from = "", to = "", limit = 50, offset = 0 }) {
  if (!datasetId) return { items: [], total: 0 };
  // backend exposes dataset-specific audit endpoint
  const qs = new URLSearchParams({ limit, offset });
  const res = await fetch(`${API_BASE}/api/dataset/${encodeURIComponent(datasetId)}/audit?${qs.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error("audit list failed");
  return res.json();
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth()+1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

function prettyAction(row) {
  const a = (row.action || "").toLowerCase();
  if (a === "upload") return `Uploaded ${row.file_name ?? row.file ?? "file"}`;
  if (a === "delete" || a === "remove") return `Deleted ${row.file_name ?? "file"}`;
  if (a.startsWith("transform") || a === "transform_v1") return `Transformed ${row.file_name ?? "file"}`;
  return row.action || row.note || "—";
}

function renderDetails(row) {
  const parts = [];
  if (row.file_name) parts.push(`File: ${row.file_name}`);
  if (row.sheet) parts.push(`Sheet: ${row.sheet}`);
  if (row.rows) parts.push(`rows: ${row.rows}`);
  if (row.field_name || row.old_value || row.new_value) {
    parts.push(`${row.field_name ?? "field"}: "${row.old_value ?? "—"}" → "${row.new_value ?? "—"}"`);
  }
  if (row.note) parts.push(row.note);
  return parts.length ? parts.join(" • ") : (row.payload ? JSON.stringify(row.payload) : "—");
}

// Simple DatasetSelector that reads datasets from parent via props
function DatasetSelector({ datasets = [], value, onSelectDataset }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm">Dataset:</label>
      <select
        className="border rounded px-2 py-1"
        value={value}
        onChange={(e) => onSelectDataset(e.target.value)}
      >
        <option value="">-- select dataset --</option>
        {datasets.map(d => (
          <option key={d.dataset_id} value={d.dataset_id}>
            {d.name ?? d.dataset_id}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function AuditTrail() {
  const [datasetId, setDatasetId] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);

  // new state: datasets + facets + filters
  const [datasets, setDatasets] = useState([]);
  const [actors, setActors] = useState([]);
  const [actions, setActions] = useState([]);
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // paging + loading
  const [limit, setLimit] = useState(50);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const offset = useMemo(() => (page - 1) * limit, [page, limit]);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    // fetch facets + datasets on mount
    (async () => {
      try {
        const fac = await getAuditFacets();
        setActors((fac.actors || []).map(x => x.actor).filter(Boolean));
        setActions((fac.actions || []).map(x => x.action).filter(Boolean));

        let ds = Array.isArray(fac.datasets) ? fac.datasets : [];
        if (!ds.length) {
          // fallback to /api/datasets
          const d2 = await getDatasets();
          ds = (Array.isArray(d2) ? d2 : []).map(d => ({
            dataset_id: d.dataset_id || d.id,
            name: d.name ?? d.dataset_id
          }));
        } else {
          ds = ds.map(d => ({ dataset_id: d.dataset_id ?? d.id, name: d.name ?? d.dataset_id }));
        }
        setDatasets(ds);

        // auto-select first dataset if nothing selected
        if (!datasetId && ds.length) setDatasetId(ds[0].dataset_id);
      } catch (e) {
        console.error(e);
        // As a last resort, try /api/datasets alone
        try {
          const d2 = await getDatasets();
          const ds = (Array.isArray(d2) ? d2 : []).map(d => ({
            dataset_id: d.dataset_id || d.id,
            name: d.name ?? d.dataset_id
          }));
          setDatasets(ds);
          if (!datasetId && ds.length) setDatasetId(ds[0].dataset_id);
        } catch (err) {
          console.error(err);
          setDatasets([]);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load table data on change
  useEffect(() => {
    (async () => {
      if (!datasetId) { setItems([]); setTotal(0); return; }
      try {
        setLoading(true);
        const r = await getAuditLog({ datasetId, actor, action, from, to, limit, offset });
        setItems(r.items || []);
        setTotal(r.total || 0);
      } catch (e) {
        console.error(e);
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    })();
  }, [datasetId, limit, offset, actor, action, from, to]);

  return (
    <div className="space-y-4">
      <DatasetSelector datasets={datasets} value={datasetId} onSelectDataset={(id) => { setDatasetId(id); setPage(1); }} />

      <Card>
        <div className="p-4 border-b text-sm font-medium">Audit Trail & Open Issues</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr className="border-b">
                <th className="p-3">Timestamp</th>
                <th className="p-3">User</th>
                <th className="p-3">Action</th>
                <th className="p-3">Dataset</th>
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td className="p-3 text-zinc-500" colSpan={5}>Loading…</td></tr>}
              {!loading && items.length === 0 && <tr><td className="p-3 text-zinc-500" colSpan={5}>No audit entries found.</td></tr>}
              {items.map((r) => {
                const details = r.field_name
                  ? `${r.field_name}: "${r.old_value ?? '—'}" → "${r.new_value ?? '—'}"${r.note ? ` | ${r.note}` : ''}`
                  : (r.note || '—');
                return (
                  <tr key={r.audit_id ?? `${r.created_at}-${Math.random()}`} className="border-b last:border-0">
                    <td className="p-3 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td className="p-3">{r.actor ?? '—'}</td>
                    <td className="p-3">{prettyAction(r)}</td>
                    <td className="p-3">{r.dataset_name ?? r.sheet ?? '—'}</td>
                    <td className="p-3">{renderDetails(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between p-3 text-sm text-zinc-600">
          <div>Total: {total}</div>
          <div className="flex items-center gap-2">
            <button className="border rounded px-2 py-1" disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
            <span>Page {page} / {totalPages}</span>
            <button className="border rounded px-2 py-1" disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        </div>
      </Card>
    </div>
  );
}