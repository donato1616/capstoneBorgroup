// frontend/src/components/charts/RegressionChart.jsx
import {
    ResponsiveContainer, LineChart, Line, CartesianGrid,
    XAxis, YAxis, Tooltip, Legend, ReferenceLine
  } from 'recharts';
  
  function toChartRows(history = [], horizon = []) {
    const rows = [];
    for (const h of history) rows.push({ date: h.date, Actual: h.actual, Fitted: h.fitted });
    if (horizon.length) {
      // continue timeline with forecast points
      for (const f of horizon) rows.push({ date: f.date, Forecast: f.projected });
    }
    return rows;
  }
  
  export default function RegressionChart({ history = [], horizon = [], unit = 'respondents/day' }) {
    const data = toChartRows(history, horizon);
    const avg =
      history && history.length
        ? history.reduce((s, r) => s + Number(r.actual || 0), 0) / history.length
        : null;
  
    return (
      <div className="w-full h-[360px]">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} label={{ value: unit, angle: -90, position: 'insideLeft', fontSize: 12 }} />
            <Tooltip formatter={(v) => Number.isFinite(v) ? Number(v) : v} />
            <Legend />
            {avg != null && (
              <ReferenceLine y={avg} strokeOpacity={0.6} strokeDasharray="4 4" />
            )}
            <Line type="monotone" dataKey="Actual" dot={false} strokeWidth={2} stroke="#2563eb" />
            <Line type="monotone" dataKey="Fitted" dot={false} strokeWidth={2} strokeDasharray="6 4" stroke="#0ea5e9" />
            <Line type="monotone" dataKey="Forecast" dot={false} strokeWidth={2} strokeDasharray="2 6" stroke="#10b981" />
          </LineChart>
        </ResponsiveContainer>
        <div className="text-xs text-zinc-500 mt-1">
          {avg != null ? `Baseline (mean): ${avg.toFixed(2)} ${unit}` : ' '}
        </div>
      </div>
    );
  }