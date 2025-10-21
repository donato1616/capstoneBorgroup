// frontend/src/pages/admin/AuditTrail.jsx
import { useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui";
import DatasetSelector from "../../components/DatasetSelector";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5050";

async function getAuditLog({ datasetId = "", limit = 50, offset = 0 }) {
  const qs = new URLSearchParams({ limit, offset });
  const res = await fetch(`${API_BASE}/api/dataset/${datasetId}/audit?${qs.toString()}`);
  if (!res.ok) throw new Error("audit list failed");
  return res.json();
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function AuditTrail() {
  const [datasetId, setDatasetId] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);

  const [limit, setLimit] = useState(50);
  const [page, setPage] = useState(1);
  const offset = useMemo(() => (page - 1) * limit, [page, limit]);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    if (!datasetId) { setItems([]); setTotal(0); return; }
    (async () => {
      try {
        const r = await getAuditLog({ datasetId, limit, offset });
        setItems(r.items || []); setTotal(r.total || 0);
      } catch (e) { console.error(e); }
    })();
  }, [datasetId, limit, offset]);

  return (
    <div className="space-y-4">
      <DatasetSelector onSelectDataset={(id) => { setDatasetId(id); setPage(1); }} />

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
              {items.length === 0 && (
                <tr><td className="p-3 text-zinc-500" colSpan={5}>No audit entries or issues.</td></tr>
              )}
              {items.map(r => (
                <tr key={r.audit_id} className="border-b last:border-0">
                  <td className="p-3 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                  <td className="p-3">{r.actor || '—'}</td>
                  <td className="p-3">{r.action || '—'}</td>
                  <td className="p-3">{r.dataset_name || '—'}</td>
                  <td className="p-3">
                    {r.field_name
                      ? `${r.field_name}: "${r.old_value ?? '—'}" → "${r.new_value ?? '—'}"${r.note ? ` | ${r.note}` : ''}`
                      : (r.note || '—')}
                  </td>
                </tr>
              ))}
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