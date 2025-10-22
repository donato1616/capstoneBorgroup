// src/pages/admin/FieldMgmt.jsx
import { useEffect, useMemo, useState } from "react";
import { Card, Filter } from "../../components/ui";
import { createPortal } from "react-dom";

const STORAGE_KEY = "ebrscorp_researchers_v1";

// Roles limited to Field Researcher and Analyst only
const ROLES = [
  { value: "FR", label: "Field Researcher" },
  { value: "AN", label: "Analyst" },
];

const STATUSES = ["Active", "Suspended", "Inactive"];

export default function FieldMgmt() {
  // seed data used only when there is nothing in localStorage
  const seed = Array.from({ length: 8 }).map((_, i) => ({
    id: i + 1,
    name: `Sample Name ${i + 1}`,
    email: `email${i + 1}@ebrscorp.com`,
    role: i % 2 === 0 ? "FR" : "AN",
    assignedProjects: (i % 3) + 1,
    status: i % 4 === 0 ? "Suspended" : "Active",
  }));

  const [researchers, setResearchers] = useState(seed);

  // unified setter that also saves to localStorage
  const setAndSave = (updater) =>
    setResearchers((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });

  // load from localStorage on first render
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setResearchers(parsed);
      } catch {}
    } else {
      // first-time load, write seed so future refreshes are stable
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Edit state
  const [editing, setEditing] = useState(null);
  const openEdit = (r) => setEditing({ ...r });
  const closeEdit = () => setEditing(null);

  // Add state
  const [addOpen, setAddOpen] = useState(false);
  const [newR, setNewR] = useState({
    name: "",
    email: "",
    role: "FR",
    assignedProjects: 0,
    status: "Active",
  });

  const resetAddForm = () =>
    setNewR({ name: "", email: "", role: "FR", assignedProjects: 0, status: "Active" });

  const nextId = () =>
    researchers.length ? Math.max(...researchers.map((r) => Number(r.id) || 0)) + 1 : 1;

  const validateEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const applyEdit = () => {
    if (!editing) return;
    const trimmed = { ...editing, name: editing.name.trim() };
    if (!trimmed.name) return alert("Name is required.");
    if (!STATUSES.includes(trimmed.status)) return alert("Invalid status.");
    if (!ROLES.find((r) => r.value === trimmed.role)) return alert("Invalid role.");
    if (Number.isNaN(Number(trimmed.assignedProjects)) || Number(trimmed.assignedProjects) < 0)
      return alert("Assigned projects must be a non-negative number.");

    setAndSave((prev) => prev.map((r) => (r.id === trimmed.id ? { ...r, ...trimmed } : r)));
    closeEdit();
  };

const addResearcher = async () => {
  const payload = {
    name: newR.name.trim(),
    email: newR.email.trim(),
    role: newR.role,
    status: newR.status,
  };

  if (!payload.name) return alert("Name is required.");
  if (!payload.email) return alert("Email is required.");
  if (!validateEmail(payload.email)) return alert("Please enter a valid email.");

  try {
    const res = await fetch("/api/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json();
      return alert(`Failed to create user: ${err.error}`);
    }

    const created = await res.json();
    setAndSave((prev) => [created, ...prev]); // optional local cache
    setAddOpen(false);
    resetAddForm();
  } catch (err) {
    console.error("Error creating researcher:", err);
    alert("Something went wrong while creating the user.");
  }
};


  const countText = useMemo(
    () => `Showing 1–${researchers.length} of ${researchers.length}`,
    [researchers.length]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="ml-auto" />
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
          Add Researcher
        </button>
      </div>

      <Card>
        <div className="p-4 border-b border-zinc-200 flex items-center justify-between">
          <div className="text-sm font-medium">Researchers</div>
          <div className="text-xs text-zinc-500">{countText}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr className="border-b border-zinc-200">
                <th className="p-3">Name</th>
                <th className="p-3">Email</th>
                <th className="p-3">Role</th>
                <th className="p-3">Assigned Projects</th>
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
                  <td className="p-3">{r.assignedProjects}</td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.status === "Active"
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                          : r.status === "Suspended"
                          ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                          : "bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button className="btn btn-ghost" onClick={() => openEdit(r)}>
                        Edit
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() =>
                          setAndSave((prev) =>
                            prev.map((x) =>
                              x.id === r.id
                                ? { ...x, status: x.status === "Suspended" ? "Active" : "Suspended" }
                                : x
                            )
                          )
                        }
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
      </Card>

      {/* Add Researcher Modal */}
      <NeatModal open={addOpen} onClose={() => setAddOpen(false)} title="Add Researcher">
        <form
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            addResearcher();
          }}
        >
          <div className="md:col-span-2">
            <Label>Name</Label>
            <Input
              value={newR.name}
              onChange={(e) => setNewR({ ...newR, name: e.target.value })}
              placeholder="Full name"
              autoFocus
            />
          </div>

          <div className="md:col-span-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={newR.email}
              onChange={(e) => setNewR({ ...newR, email: e.target.value })}
              placeholder="name@company.com"
            />
          </div>

          <div>
            <Label>Role</Label>
            <Select
              value={newR.role}
              onChange={(e) => setNewR({ ...newR, role: e.target.value })}
              options={ROLES}
            />
          </div>

          <div>
            <Label>Status</Label>
            <Select
              value={newR.status}
              onChange={(e) => setNewR({ ...newR, status: e.target.value })}
              options={STATUSES.map((s) => ({ value: s, label: s }))}
            />
          </div>

          <div className="md:col-span-2">
            <Label>Assigned Projects</Label>
            <Input
              type="number"
              min={0}
              value={newR.assignedProjects}
              onChange={(e) =>
                setNewR({ ...newR, assignedProjects: Number(e.target.value) })
              }
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Enter total count of active assignments for this researcher.
            </p>
          </div>

          <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setAddOpen(false);
                resetAddForm();
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Add
            </button>
          </div>
        </form>
      </NeatModal>

      {/* Edit Modal */}
      <NeatModal open={!!editing} onClose={closeEdit} title="Edit Researcher">
        {editing && (
          <form
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              applyEdit();
            }}
          >
            <div className="md:col-span-2">
              <Label>Name</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Full name"
                autoFocus
              />
            </div>

            <div>
              <Label>Role</Label>
              <Select
                value={editing.role}
                onChange={(e) => setEditing({ ...editing, role: e.target.value })}
                options={ROLES}
              />
            </div>

            <div>
              <Label>Status</Label>
              <Select
                value={editing.status}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                options={STATUSES.map((s) => ({ value: s, label: s }))}
              />
            </div>

            <div className="md:col-span-2">
              <Label>Assigned Projects</Label>
              <Input
                type="number"
                min={0}
                value={editing.assignedProjects}
                onChange={(e) =>
                  setEditing({ ...editing, assignedProjects: Number(e.target.value) })
                }
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                Enter total count of active assignments for this researcher.
              </p>
            </div>

            <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2">
              <button type="button" className="btn btn-ghost" onClick={closeEdit}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Apply changes
              </button>
            </div>
          </form>
        )}
      </NeatModal>
    </div>
  );
}

/* ---------- Small UI helpers ---------- */

function Label({ children }) {
  return <label className="block text-xs font-medium text-zinc-600 mb-1.5">{children}</label>;
}

function Input(props) {
  return (
    <input
      {...props}
      className={`input w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm shadow-sm outline-none transition
      placeholder:text-zinc-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100`}
    />
  );
}

function Select({ options = [], ...rest }) {
  return (
    <select
      {...rest}
      className="input w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-[9px] text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
    >
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>
          {o.label ?? o}
        </option>
      ))}
    </select>
  );
}

/* ---------- Polished Modal ---------- */

function NeatModal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const modalUI = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      {/* Make backdrop fixed so it truly covers the viewport */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm"></div>

      <div
        className="relative w-full max-w-lg transform overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 transition-all
        animate-[modalIn_180ms_ease-out] will-change-transform"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 bg-gradient-to-r from-white to-indigo-50">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-indigo-100 text-indigo-700 grid place-items-center text-xs font-bold">
              ✎
            </div>
            <h3 className="text-sm font-semibold text-zinc-800">{title}</h3>
          </div>
          <button
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-4">{children}</div>
      </div>

      <style>{`
        @keyframes modalIn {
          0% { opacity: 0; transform: translateY(8px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );

  // Render at document.body to escape any parent stacking/overflow contexts
  return createPortal(modalUI, document.body);
}
