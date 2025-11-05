// frontend/src/components/charts/RegressionChart.jsx
import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

const COLORS = {
  Actual:   "#0ea5e9", // sky-500
  Fitted:   "#6366f1", // indigo-500
  Forecast: "#f59e0b", // amber-500
  Baseline: "#6b7280", // gray-500
};

function toRows(history = [], horizon = []) {
  const h = history.map((x) => ({ date: x.date, Actual: x.actual, Fitted: x.fitted }));
  const f = horizon.map((x) => ({ date: x.date, Forecast: x.projected }));
  // merge by date
  const map = new Map();
  [...h, ...f].forEach((r) => {
    map.set(r.date, { ...(map.get(r.date) || {}), ...r });
  });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, row]) => ({ date, ...row }));
}

export default function RegressionChart({ history = [], horizon = [], unit = "respondents/day", baselineMean }) {
  const rows = useMemo(() => toRows(history, horizon), [history, horizon]);

  return (
    <div className="w-full h-[360px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} label={{ value: unit, angle: -90, position: "insideLeft", offset: 8 }} />
          <Tooltip />
          <Legend />

          {baselineMean != null && (
            <ReferenceLine
              y={baselineMean}
              stroke={COLORS.Baseline}
              strokeDasharray="6 6"
              label={{ value: `Baseline (mean)`, position: "right", fill: COLORS.Baseline, fontSize: 12 }}
            />
          )}

          <Line type="monotone" dataKey="Actual" stroke={COLORS.Actual} dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="Fitted" stroke={COLORS.Fitted} dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="Forecast" stroke={COLORS.Forecast} dot={false} strokeWidth={2} strokeDasharray="6 6" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}