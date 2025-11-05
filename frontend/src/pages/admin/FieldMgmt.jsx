// src/pages/admin/FieldMgmt.jsx
import { useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui";
import { createPortal } from "react-dom";

const ROLES = [
  { value: "FR", label: "Field Researcher" },
  { value: "AN", label: "Analyst" },
];
const STATUSES = ["Active", "Suspended", "Inactive"];

const API_BASE = import.meta.env.VITE_API_BASE || ""; // e.g. "" or "http://localhost:5050"

export default function FieldMgmt() {
  const [researchers, setResearchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add / edit modal state
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const emptyForm = { name: "", email: "", role: "FR", status: "Active" };
  const [form, setForm] = useState(emptyForm);

  // fetch list
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/field/all`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResearchers(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Error fetching researchers:", err);
        setError("Failed to load researchers.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const validateEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  // Create
  const addResearcher = async () => {
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
      status: form.status,
    };
    if (!payload.name) return alert("Name is required.");
    if (!payload.email) return alert("Email is required.");
    if (!validateEmail(payload.email)) return alert("Invalid email.");

    try {
      const res = await fetch(`${API_BASE}/api/field/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        return alert(body?.error || "Failed to create.");
      }
      setResearchers((p) => [body, ...p]);
      setAddOpen(false);
      setForm(emptyForm);
    } catch (err) {
      console.error(err);
      alert("Something went wrong.");
    }
  };

  // Open edit modal
  const openEdit = (r) => {
    setEditing(r);
    setForm({
      name: r.name || "",
      email: r.email || "",
      role: r.role || "FR",
      status: r.status || "Active",
    });
    setEditOpen(true);
  };

  // Apply edit
  const applyEdit = async () => {
    if (!editing) return;
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
      status: form.status,
    };
    if (!payload.name) return alert("Name is required.");
    if (!payload.email) return alert("Email is required.");
    if (!validateEmail(payload.email)) return alert("Invalid email.");

    try {
      const res = await fetch(`${API_BASE}/api/field/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) return alert(body?.error || "Failed to update.");
      setResearchers((prev) => prev.map((r) => (r.id === body.id ? body : r)));
      setEditOpen(false);
      setEditing(null);
      setForm(emptyForm);
    } catch (err) {
      console.error(err);
      alert("Update failed.");
    }
  };

  // Toggle suspend/activate
  const toggleStatus = async (r) => {
    try {
      const res = await fetch(`${API_BASE}/api/field/${r.id}/toggle-status`, {
        method: "PATCH",
      });
      const body = await res.json();
      if (!res.ok) return alert(body?.error || "Failed to toggle status");
      setResearchers((prev) => prev.map((x) => (x.id === body.id ? body : x)));
    } catch (err) {
      console.error(err);
      alert("Failed to update status.");
    }
  };

  const countText = useMemo(
    () => `Showing ${researchers.length} researcher${researchers.length !== 1 ? "s" : ""}`,
    [researchers.length]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="ml-auto" />
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
          Add Researcher
        </button>
      </div>

      <Card>
        <div className="p-4 border-b flex items-center justify-between">
          <div className="text-sm font-medium">Researchers</div>
          <div className="text-xs text-zinc-500">{countText}</div>
        </div>

        <div className="p-4">
          {loading && <div className="text-sm text-zinc-500">Loading…</div>}
          {error && <div className="text-sm text-rose-600">{error}</div>}

          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-zinc-500">
                  <tr className="border-b border-zinc-200">
                    <th className="p-3">Name</th>
                    <th className="p-3">Email</th>
                    <th className="p-3">Role</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {researchers.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="p-3">{r.name}</td>
                      <td className="p-3">{r.email}</td>
                      <td className="p-3">{r.role}</td>
                      <td className="p-3">{r.status}</td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <button className="btn btn-ghost" onClick={() => openEdit(r)}>Edit</button>
                          <button
                            className="btn btn-ghost"
                            onClick={() => toggleStatus(r)}
                          >
                            {r.status === "Suspended" ? "Activate" : "Suspend"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Add modal */}
      <NeatModal open={addOpen} onClose={() => setAddOpen(false)} title="Add Researcher">
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            addResearcher();
          }}
        >
          <Label>Name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Label>Email</Label>
          <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Label>Role</Label>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={ROLES} />
          <Label>Status</Label>
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={STATUSES.map((s) => ({ value: s, label: s }))} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Add</button>
          </div>
        </form>
      </NeatModal>

      {/* Edit modal */}
      <NeatModal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Researcher">
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            applyEdit();
          }}
        >
          <Label>Name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Label>Email</Label>
          <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Label>Role</Label>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={ROLES} />
          <Label>Status</Label>
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={STATUSES.map((s) => ({ value: s, label: s }))} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost" onClick={() => { setEditOpen(false); setEditing(null); }}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </NeatModal>
    </div>
  );
}

/* ---------- UI helpers ---------- */
function Label({ children }) {
  return <label className="block text-xs font-medium text-zinc-600 mb-1.5">{children}</label>;
}
function Input(props) {
  return <input {...props} className="input w-full rounded-xl border px-3 py-2 text-sm shadow-sm" />;
}
function Select({ options = [], ...rest }) {
  return (
    <select {...rest} className="input w-full rounded-xl border px-3 py-[9px] text-sm shadow-sm">
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  );
}
function NeatModal({ open, onClose, title, children }) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="bg-white rounded-xl p-4 w-full max-w-md shadow-xl">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}