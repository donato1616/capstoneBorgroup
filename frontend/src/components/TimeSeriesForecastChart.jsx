// TimeSeriesForecastChart.jsx
import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
} from 'recharts';

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString(); } catch { return d; }
}

export default function TimeSeriesForecastChart({
  history = [],         // [{date, actual, fitted, confidence_lower?, confidence_upper?}]
  horizon = [],         // [{date, projected, confidence_lower?, confidence_upper?}]
  yLabel = 'value',
  xLabel = 'Date',
  header = 'Time-Series Forecasting',
  modelInfo = null,     // { type, parameters? } — optional, for the tiny header label
  tinyLabelOverride = null, // string — optional, overrides auto tiny label
  includeAnchor = true, // connect last fitted -> first forecast with a point on last hist date
}) {
  // Build tiny right-aligned label text
  const tiny = useMemo(() => {
    if (tinyLabelOverride) return tinyLabelOverride;
    const parts = [];
    if (modelInfo?.type) parts.push(String(modelInfo.type));
    if (modelInfo?.parameters) {
      const p = modelInfo.parameters;
      const pStr = Object.keys(p)
        .slice(0, 6)
        .map(k => `${k}=${String(p[k])}`)
        .join(', ');
      if (pStr) parts.push(pStr);
    }
    if (Array.isArray(horizon) && horizon.length) parts.push(`h=${horizon.length}`);
    return parts.join(' • ');
  }, [modelInfo, horizon, tinyLabelOverride]);

  // last historical date for shading forecast region
  const lastHist = useMemo(() => {
    if (!history?.length) return null;
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.at(-1)?.date ?? null;
  }, [history]);

  // Flatten history+horizon keyed by date; optionally add anchor at lastHist
  const rows = useMemo(() => {
    const byDate = new Map();

    // History rows
    (history || []).forEach(h => {
      const r = byDate.get(h.date) || { date: h.date };
      r.actual   = h.actual ?? r.actual ?? null;
      r.fitted   = h.fitted ?? r.fitted ?? null;
      r.ciLower  = h.confidence_lower ?? r.ciLower ?? null;
      r.ciUpper  = h.confidence_upper ?? r.ciUpper ?? null;
      r.isForecast = false;
      byDate.set(h.date, r);
    });

    // Forecast rows
    (horizon || []).forEach(h => {
      const r = byDate.get(h.date) || { date: h.date };
      r.forecast = h.projected ?? r.forecast ?? null;
      r.ciLower  = h.confidence_lower ?? r.ciLower ?? null;
      r.ciUpper  = h.confidence_upper ?? r.ciUpper ?? null;
      r.isForecast = true;
      byDate.set(h.date, r);
    });

    // Optional anchor: put a forecast value on last historical date so the forecast line connects
    if (includeAnchor && lastHist && byDate.has(lastHist)) {
      const r = byDate.get(lastHist);
      if (r && (r.fitted != null || r.actual != null) && r.forecast == null) {
        r.forecast = r.fitted ?? r.actual ?? null;
        byDate.set(lastHist, r);
      }
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [history, horizon, includeAnchor, lastHist]);

  if (!rows.length) {
    return <div className="text-sm text-zinc-500">No time-series data.</div>;
  }

  return (
    <div className="w-full">
      {/* Header with tiny right-aligned label */}
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-sm font-medium">{header}</div>
        {tiny ? <div className="text-xs text-zinc-500">{tiny}</div> : null}
      </div>

      <div style={{ height: 340 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              interval="preserveStartEnd"
              tick={{ fontSize: 12 }}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 10 }}
              allowDecimals
            />

            {/* Confidence bounds (if present) */}
            <Line
              type="monotone"
              dataKey="ciUpper"
              name="Upper CI"
              stroke="#9ca3af"
              dot={false}
              strokeDasharray="4 4"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="ciLower"
              name="Lower CI"
              stroke="#9ca3af"
              dot={false}
              strokeDasharray="4 4"
              isAnimationActive={false}
            />

            {/* Actual / Fitted / Forecast */}
            <Line
              type="monotone"
              dataKey="actual"
              name="Actual"
              stroke="#0ea5e9"
              strokeWidth={2}
              dot={{ r: 2 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="fitted"
              name="Fitted"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              name="Forecast"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={{ r: 2 }}
              isAnimationActive={false}
            />
            {/* Light fill under forecast for emphasis */}
            <Area
              type="monotone"
              dataKey="forecast"
              stroke="none"
              fill="#f59e0b"
              fillOpacity={0.08}
              isAnimationActive={false}
            />

            {/* Shade the forecast period */}
            {lastHist && (
              <ReferenceArea
                x1={lastHist}
                x2={rows[rows.length - 1].date}
                fill="#f59e0b"
                fillOpacity={0.05}
                ifOverflow="extendDomain"
              />
            )}

            <Tooltip
              formatter={(v, n) => [v, n]}
              labelFormatter={(d) => `${xLabel}: ${fmtDate(d)}`}
            />
            <Legend />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 text-xs text-zinc-500">
        Dashed grey lines show the 95% confidence bounds (when available).
      </div>
    </div>
  );
}