// frontend/src/pages/admin/Prescriptive.jsx
import { useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui";
import DatasetSelector from "../../components/DatasetSelector";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5050";

export default function PrescriptiveInsights() {
  const [datasetId, setDatasetId] = useState("");
  const [target, setTarget] = useState(200); // target respondents to complete
  const [deadline, setDeadline] = useState(() => new Date(Date.now() + 7*86400000).toISOString().slice(0,10));
  const [rate, setRate] = useState(8); // interviews per interviewer per day
  const [workdays, setWorkdays] = useState(6); // working days per week
  const [plan, setPlan] = useState(null);
  const [alloc, setAlloc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const canCompute = datasetId && target > 0 && rate > 0 && workdays > 0 && !!deadline;

  async function compute() {
    if (!canCompute) return;
    setLoading(true); setErr(""); setPlan(null); setAlloc(null);
    try {
      const u1 = new URL(`${API_BASE}/api/dataset/${datasetId}/prescriptive/staffing`);
      u1.searchParams.set("target", String(target));
      u1.searchParams.set("deadline", deadline);
      u1.searchParams.set("rate", String(rate));
      u1.searchParams.set("workdays", String(workdays));
      const r1 = await fetch(u1);
      if (!r1.ok) throw new Error(`Staffing HTTP ${r1.status}`);
      const p = await r1.json();
      setPlan(p);

      const u2 = new URL(`${API_BASE}/api/dataset/${datasetId}/prescriptive/region-allocation`);
      u2.searchParams.set("target", String(target));
      const r2 = await fetch(u2);
      if (!r2.ok) throw new Error(`Allocation HTTP ${r2.status}`);
      setAlloc(await r2.json());
    } catch (e) {
      setErr(e.message || "Failed to compute plan");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-lg font-semibold">Prescriptive Insights</div>
        <div className="text-sm text-zinc-600">Staffing planner & region allocation based on your current dataset.</div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-medium mb-1">Choose dataset</div>
        <DatasetSelector onSelectDataset={setDatasetId} />
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 mt-3">
          <label className="text-sm">
            Target completes
            <input type="number" className="block w-full border rounded px-2 py-1 mt-1"
                   value={target} onChange={e=>setTarget(Number(e.target.value||0))}/>
          </label>
          <label className="text-sm">
            Deadline (YYYY-MM-DD)
            <input type="date" className="block w-full border rounded px-2 py-1 mt-1"
                   value={deadline} onChange={e=>setDeadline(e.target.value)}/>
          </label>
          <label className="text-sm">
            Rate (interviews / interviewer / day)
            <input type="number" className="block w-full border rounded px-2 py-1 mt-1"
                   value={rate} onChange={e=>setRate(Number(e.target.value||0))}/>
          </label>
          <label className="text-sm">
            Workdays / week
            <input type="number" className="block w-full border rounded px-2 py-1 mt-1"
                   value={workdays} onChange={e=>setWorkdays(Number(e.target.value||0))}/>
          </label>
          <div className="flex items-end">
            <button className="px-3 py-2 rounded bg-olive-700 text-white disabled:opacity-60"
                    disabled={!canCompute || loading}
                    onClick={compute}>
              {loading ? "Computing..." : "Compute plan"}
            </button>
          </div>
        </div>
        {err && <div className="text-sm text-rose-600 mt-2">Error: {err}</div>}
      </Card>

      {plan && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="p-4">
            <div className="text-xs text-zinc-500">Interviewers required</div>
            <div className="text-2xl font-semibold mt-1">{plan.required_interviewers}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-zinc-500">Available workdays</div>
            <div className="text-2xl font-semibold mt-1">{plan.available_workdays}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-zinc-500">Capacity (max completes)</div>
            <div className="text-2xl font-semibold mt-1">{plan.max_capacity}</div>
          </Card>

          <Card className="p-4 sm:col-span-3">
            <div className="text-sm font-medium mb-2">Daily plan</div>
            <div className="overflow-auto">
              <table className="min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-1 pr-4">Date</th>
                    <th className="py-1 pr-4">Assigned Interviewers</th>
                    <th className="py-1 pr-4">Expected Completes</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.daily_plan.map((d, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-4">{d.date}</td>
                      <td className="py-1 pr-4">{d.interviewers}</td>
                      <td className="py-1 pr-4">{d.expected_completes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {alloc && (
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Region allocation</div>
          <div className="overflow-auto">
            <table className="min-w-[520px] text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-1 pr-4">Region</th>
                  <th className="py-1 pr-4">Historical Share</th>
                  <th className="py-1 pr-4">Assigned Completes</th>
                </tr>
              </thead>
              <tbody>
                {alloc.items.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 pr-4">{r.region}</td>
                    <td className="py-1 pr-4">{(r.share * 100).toFixed(1)}%</td>
                    <td className="py-1 pr-4">{r.assigned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}