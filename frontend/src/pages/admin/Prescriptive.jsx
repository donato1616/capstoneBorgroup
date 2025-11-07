import { useEffect, useMemo, useState } from "react";
import DatasetSelector from "../../components/DatasetSelector";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5050";

export default function PrescriptiveInsights() {
  const [datasetId, setDatasetId] = useState("");
  const [target, setTarget] = useState(200);
  const [deadline, setDeadline] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [rate, setRate] = useState(8);
  const [workdays, setWorkdays] = useState(6);
  const [plan, setPlan] = useState(null);
  const [alloc, setAlloc] = useState(null);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const canCompute = datasetId && target > 0 && rate > 0 && workdays > 0 && !!deadline;

  async function compute() {
    if (!canCompute) return;
    setLoading(true);
    setErr("");
    setPlan(null);
    setAlloc(null);
    setInsights(null);
    try {
      // 1) staffing - using enhanced endpoint
      const u1 = new URL(`${API_BASE}/api/dataset/${datasetId}/prescriptive/staffing`);
      u1.searchParams.set("target", String(target));
      u1.searchParams.set("deadline", deadline);
      u1.searchParams.set("rate", String(rate));
      u1.searchParams.set("workdays", String(workdays));

      const r1 = await fetch(u1);
      if (!r1.ok) throw new Error(`Staffing HTTP ${r1.status}`);
      setPlan(await r1.json());

      // 2) region allocation - NEW endpoint
      const u2 = new URL(`${API_BASE}/api/dataset/${datasetId}/prescriptive/region-allocation`);
      u2.searchParams.set("target", String(target));
      const r2 = await fetch(u2);
      if (!r2.ok) throw new Error(`Allocation HTTP ${r2.status}`);
      setAlloc(await r2.json());

      // 3) enhanced insights with rule-based logic and decision trees
      const u3 = new URL(`${API_BASE}/api/dataset/${datasetId}/prescriptive/insights`);
      u3.searchParams.set("target", String(target));
      u3.searchParams.set("deadline", deadline);
      u3.searchParams.set("rate", String(rate));
      u3.searchParams.set("workdays", String(workdays));
      const r3 = await fetch(u3);
      if (!r3.ok) throw new Error(`Insights HTTP ${r3.status}`);
      setInsights(await r3.json());
    } catch (e) {
      setErr(e.message || "Failed to compute plan");
    } finally {
      setLoading(false);
    }
  }

  // Helper function to render recommendation items
  const RecommendationItem = ({ recommendation, index }) => (
    <li key={index} className="p-3 rounded-lg border">
      <div className="flex items-center gap-2">
        <span
          className={
            "inline-block h-2 w-2 rounded-full " +
            (recommendation.priority === "high" 
              ? "bg-rose-500" 
              : recommendation.priority === "medium" 
                ? "bg-amber-500" 
                : "bg-emerald-500")
          }
        />
        <div className="font-medium">{recommendation.title}</div>
        <div className="text-xs text-zinc-500 ml-2">({recommendation.priority})</div>
        {recommendation.type && (
          <div className="text-xs bg-zinc-100 px-2 py-1 rounded capitalize">
            {recommendation.type.replace(/_/g, ' ')}
          </div>
        )}
      </div>
      <div className="text-sm mt-1">{recommendation.text}</div>
      {recommendation.rule && (
        <div className="text-xs text-zinc-500 mt-1">
          Rule: {recommendation.rule}
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="text-lg font-semibold">Prescriptive Insights</div>
        <div className="text-sm text-zinc-600">
          Staffing, region allocation, and auto-generated action recommendations with rule-based logic and decision tree optimization.
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
        <div className="text-sm font-medium mb-1">Choose dataset</div>
        <DatasetSelector onSelectDataset={setDatasetId} />
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 mt-3">
          <label className="text-sm">
            Target completes
            <input
              type="number"
              className="block w-full border rounded px-2 py-1 mt-1"
              value={target}
              onChange={(e) => setTarget(Number(e.target.value || 0))}
            />
          </label>
          <label className="text-sm">
            Deadline (YYYY-MM-DD)
            <input
              type="date"
              className="block w-full border rounded px-2 py-1 mt-1"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Rate (interviews / interviewer / day)
            <input
              type="number"
              className="block w-full border rounded px-2 py-1 mt-1"
              value={rate}
              onChange={(e) => setRate(Number(e.target.value || 0))}
            />
          </label>
          <label className="text-sm">
            Workdays / week
            <input
              type="number"
              className="block w-full border rounded px-2 py-1 mt-1"
              value={workdays}
              onChange={(e) => setWorkdays(Number(e.target.value || 0))}
            />
          </label>
          <div className="flex items-end">
            <button
              className="px-3 py-2 rounded bg-olive-700 text-white disabled:opacity-60"
              disabled={!canCompute || loading}
              onClick={compute}
            >
              {loading ? "Computing..." : "Compute plan"}
            </button>
          </div>
        </div>
        {err && <div className="text-sm text-rose-600 mt-2">Error: {err}</div>}
      </div>

      {/* Staffing Plan */}
      {plan && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="text-xs text-zinc-500">Interviewers required</div>
            <div className="text-2xl font-semibold mt-1">{plan.required_interviewers}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="text-xs text-zinc-500">Available workdays</div>
            <div className="text-2xl font-semibold mt-1">{plan.available_workdays}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="text-xs text-zinc-500">Capacity (max completes)</div>
            <div className="text-2xl font-semibold mt-1">{plan.max_capacity}</div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 sm:col-span-3">
            <div className="text-sm font-medium mb-2">Daily Plan</div>
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
            {plan.assumptions && (
              <div className="mt-3 text-xs text-zinc-500">
                Assumptions: {plan.assumptions.interviews_per_interviewer_per_day} interviews/day per interviewer, 
                effective rate: {plan.assumptions.effective_rate_based_on_history}/day
              </div>
            )}
          </div>
        </div>
      )}

      {/* Region Allocation */}
      {alloc && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-medium mb-2">Region Allocation</div>
          <div className="text-xs text-zinc-500 mb-3">
            Allocation method: {alloc.allocation_method || 'historical_distribution'}
          </div>
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
        </div>
      )}

      {/* Enhanced Insights with Rule-Based Logic and Decision Trees */}
      {insights && (
        <div className="space-y-4">
          {/* Rule-Based Alerts Section */}
          {insights.rule_based_alerts && insights.rule_based_alerts.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="text-sm font-medium mb-2 text-rose-700">Rule-Based Alerts</div>
              <div className="text-xs text-rose-600 mb-3">
                Automated alerts based on threshold rules and business logic
              </div>
              <ul className="space-y-3">
                {insights.rule_based_alerts.map((r, i) => (
                  <RecommendationItem key={i} recommendation={r} index={i} />
                ))}
              </ul>
            </div>
          )}

          {/* Optimization Paths Section */}
          {insights.optimization_paths && insights.optimization_paths.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-medium mb-2 text-amber-700">Optimization Recommendations</div>
              <div className="text-xs text-amber-600 mb-3">
                Decision tree analysis for optimal resource allocation and timing
              </div>
              <ul className="space-y-3">
                {insights.optimization_paths.map((r, i) => (
                  <RecommendationItem key={i} recommendation={r} index={i} />
                ))}
              </ul>
            </div>
          )}

          {/* Next Best Actions Section */}
          {insights.next_best_actions && insights.next_best_actions.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-sm font-medium mb-2 text-emerald-700">Next Best Actions</div>
              <div className="text-xs text-emerald-600 mb-3">
                Prioritized actions based on current performance and targets
              </div>
              <ul className="space-y-3">
                {insights.next_best_actions.map((r, i) => (
                  <RecommendationItem key={i} recommendation={r} index={i} />
                ))}
              </ul>
            </div>
          )}

          {/* Combined Recommendations (Fallback) */}
          {insights.recommendations && insights.recommendations.length > 0 && 
           (!insights.rule_based_alerts && !insights.optimization_paths && !insights.next_best_actions) && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="text-sm font-medium mb-2">Actionable Insights</div>
              <ul className="space-y-3">
                {insights.recommendations.map((r, i) => (
                  <RecommendationItem key={i} recommendation={r} index={i} />
                ))}
              </ul>
            </div>
          )}

          {/* Performance Metrics */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="text-sm font-medium mb-2">Performance Metrics</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-xs text-zinc-500">Current Pace</div>
                <div className="font-semibold">{insights.metrics.trailing7_avg}/day</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Required Rate</div>
                <div className="font-semibold">{insights.metrics.required_rate}/day</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Daily Gap</div>
                <div className={`font-semibold ${insights.metrics.gap_per_day > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {insights.metrics.gap_per_day > 0 ? '+' : ''}{insights.metrics.gap_per_day}/day
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Extra Interviewers</div>
                <div className="font-semibold">{insights.metrics.extra_interviewers}</div>
              </div>
            </div>
            
            <div className="mt-4 text-xs text-zinc-500">
              Inputs: target {insights.inputs.target}, deadline {insights.inputs.deadline}, 
              rate {insights.inputs.rate}/day, workdays {insights.inputs.workdays}/week. 
              Completion: {insights.metrics.completed_pct}% ({insights.metrics.completed_respondents}/{insights.metrics.respondent_count} respondents)
            </div>
          </div>
        </div>
      )}
    </div>
  );
}