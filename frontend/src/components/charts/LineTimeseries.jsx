// frontend/src/components/charts/LineTimeseries.jsx
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
} from "recharts";

// High-contrast color palette, consistent across the app
const SERIES_COLORS = {
  Actual:   "#0ea5e9", // sky-500
  Fitted:   "#6366f1", // indigo-500
  Forecast: "#f59e0b", // amber-500
  Baseline: "#6b7280", // gray-500 (use dashed)
};

function mergeSeries(series) {
  // series = [{ name, data: [{date, value}, ...] }, ...]
  const allDates = new Set();
  for (const s of series || []) {
    for (const p of s.data || []) allDates.add(p.date);
  }
  const rows = [...allDates].sort().map((date) => ({ date }));
  for (const s of series || []) {
    const map = new Map((s.data || []).map((d) => [d.date, d.value]));
    for (const r of rows) r[s.name] = map.get(r.date) ?? null;
  }
  return rows;
}

export default function LineTimeseries({ series = [], yLabel = "" }) {
  const data = useMemo(() => mergeSeries(series), [series]);

  return (
    <div className="w-full h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", offset: 8 } : undefined}/>
          <Tooltip />
          <Legend />

          {/* Draw lines with consistent colors + dashes for forecast/baseline */}
          {series.map((s) => {
            const color = SERIES_COLORS[s.name] || "#10b981"; // fallback emerald
            const dashed = s.name === "Forecast" || s.name === "Baseline";
            return (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={color}
                dot={false}
                strokeWidth={2}
                strokeDasharray={dashed ? "6 6" : "0"}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}