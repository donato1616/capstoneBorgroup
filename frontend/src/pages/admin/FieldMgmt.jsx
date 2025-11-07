import { useEffect, useState, useMemo } from "react";
import { Card } from "../../components/ui";
import { createPortal } from "react-dom";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export default function FieldMgmt() {
  const [interviewers, setInterviewers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal states
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "" });

  // Fetch interviewers
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/field/all`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setInterviewers(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Error fetching interviewers:", err);
        setError("Failed to load interviewers.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Open edit modal
  const openEdit = (i) => {
    setEditing(i);
    setForm({ name: i.name });
    setEditOpen(true);
  };

  // Apply edit
  const applyEdit = async () => {
    if (!editing) return;
    const payload = { code: form.name.trim() };
    if (!payload.code) return alert("Name/Code is required.");

    try {
      const res = await fetch(`${API_BASE}/api/field/update/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) return alert(body?.error || "Failed to update.");
      setInterviewers((prev) => prev.map((i) => (i.id === body.id ? body : i)));
      setEditOpen(false);
      setEditing(null);
      setForm({ name: "" });
    } catch (err) {
      console.error(err);
      alert("Update failed.");
    }
  };

  // Add new interviewer
  const addInterviewer = async () => {
    const code = form.name.trim();
    if (!code) return alert("Name/Code is required.");

    try {
      const res = await fetch(`${API_BASE}/api/field/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json();
      if (!res.ok) return alert(body?.error || "Failed to add interviewer.");
      setInterviewers((prev) => [body, ...prev]);
      setAddOpen(false);
      setForm({ name: "" });
    } catch (err) {
      console.error("Add interviewer failed:", err);
      alert("Failed to add interviewer.");
    }
  };

  // Suspend/Activate stub
  const toggleStatus = async (i) => {
    try {
      const res = await fetch(`${API_BASE}/api/field/toggle-status/${i.id}`, {
        method: "PUT",
      });
      const body = await res.json();
      if (!res.ok) return alert(body?.error || "Failed to toggle status");
      alert("Suspend/Activate placeholder executed.");
    } catch (err) {
      console.error(err);
      alert("Failed to toggle status.");
    }
  };

  const countText = useMemo(
    () => `Showing ${interviewers.length} interviewer${interviewers.length !== 1 ? "s" : ""}`,
    [interviewers.length]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Field Interviewers</div>
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
          + Add Researcher
        </button>
      </div>

      <Card>
        <div className="p-4 border-b flex items-center justify-between">
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
                    <th className="p-3">Completed Interviews</th>
                    <th className="p-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {interviewers.map((i) => (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="p-3">{i.name?.toUpperCase()}</td>
                      <td className="p-3">{i.completedCount}</td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <button className="btn btn-ghost" onClick={() => openEdit(i)}>
                            Edit
                          </button>
                          <button className="btn btn-ghost" onClick={() => toggleStatus(i)}>
                            Suspend
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
      <NeatModal open={addOpen} onClose={() => setAddOpen(false)} title="Add Interviewer">
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            addInterviewer();
          }}
        >
          <Label>Name</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Enter interviewer name/code"
          />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Add
            </button>
          </div>
        </form>
      </NeatModal>

      {/* Edit modal */}
      <NeatModal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Interviewer">
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            applyEdit();
          }}
        >
          <Label>Name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save
            </button>
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
function NeatModal({ open, onClose, title, children }) {
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
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