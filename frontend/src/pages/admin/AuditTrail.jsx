// frontend/src/pages/admin/AuditTrail.jsx
import { useEffect, useMemo, useState } from "react";
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
  const qs = new URLSearchParams({ datasetId, actor, action, from, to, limit, offset });
  const res = await fetch(`${API_BASE}/api/audit?${qs.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error("audit list failed");
  return res.json(); // {total, items:[...]}
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth()+1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AuditTrail() {
  // filters
  const [datasetId, setDatasetId] = useState(""); // uuid or legacy int
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // facets + data
  const [datasets, setDatasets] = useState([]);
  const [actors, setActors] = useState([]);
  const [actions, setActions] = useState([]);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);

  // paging
  const [limit, setLimit] = useState(50);
  const [page, setPage] = useState(1);
  const offset = useMemo(() => (page - 1) * limit, [page, limit]);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // load facets once (and fall back to /api/datasets if needed)
  useEffect(() => {
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
            name: d.name
          }));
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
            name: d.name
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
      try {
        const r = await getAuditLog({ datasetId, actor, action, from, to, limit, offset });
        setItems(r.items || []);
        setTotal(r.total || 0);
      } catch (e) { console.error(e); }
    })();
  }, [datasetId, actor, action, from, to, limit, offset]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-600">Dataset</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={datasetId}
            onChange={(e) => { setDatasetId(e.target.value); setPage(1); }}
          >
            {datasets.length === 0 && <option value="">— No datasets —</option>}
            {datasets.map(d => (
              <option key={d.dataset_id} value={d.dataset_id}>{d.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-600">User</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={actor}
            onChange={(e) => { setActor(e.target.value); setPage(1); }}
          >
            <option value="">All</option>
            {actors.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-600">Action</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
          >
            <option value="">All</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-600">From</span>
          <input
            type="date"
            className="border rounded px-2 py-1 text-sm"
            value={from}
            onChange={(e) => { setFrom(e.target.value); setPage(1); }}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-600">To</span>
          <input
            type="date"
            className="border rounded px-2 py-1 text-sm"
            value={to}
            onChange={(e) => { setTo(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <div className="p-4 border-b border-zinc-200 text-sm font-medium">Audit Trail</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr className="border-b border-zinc-200">
                <th className="p-3">Timestamp</th>
                <th className="p-3">User</th>
                <th className="p-3">Action</th>
                <th className="p-3">Extent</th>
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td className="p-3 text-zinc-500" colSpan={5}>No audit entries found.</td></tr>
              )}
              {items.map((r) => {
                const details = r.field_name
                  ? `${r.field_name}: "${r.old_value ?? '—'}" → "${r.new_value ?? '—'}"${r.note ? ` | ${r.note}` : ''}`
                  : (r.note || '—');
                return (
                  <tr key={r.audit_id} className="border-b last:border-0">
                    <td className="p-3 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td className="p-3">{r.actor || '—'}</td>
                    <td className="p-3">{r.action || '—'}</td>
                    <td className="p-3">{r.dataset_name || '—'}</td>
                    <td className="p-3">{details}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pager */}
        <div className="flex items-center justify-between p-3 text-sm text-zinc-600">
          <div>Total: {total}</div>
          <div className="flex items-center gap-2">
            <button
              className="border rounded px-2 py-1"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span>Page {page} / {totalPages}</span>
            <button
              className="border rounded px-2 py-1"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
