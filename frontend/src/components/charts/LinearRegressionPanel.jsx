// LinearRegressionPanel.jsx
import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';

/**
 * Simple linear regression visual:
 *  - x := time index (0..n-1)
 *  - scatter := actual values vs index
 *  - line := fitted line using slope/intercept when present, else fit through history.fitted
 */
export default function LinearRegressionPanel({
  history = [],             // [{date, actual, fitted}]
  modelInfo = null,         // { type, parameters: { slope, intercept } }
  yLabel = 'value',
}) {
  const data = useMemo(() => {
    return (history || []).map((d, i) => ({
      i,
      date: d.date,
      actual: d.actual ?? null,
      fitted: d.fitted ?? null,
    }));
  }, [history]);

  // Final slope/intercept for the line
  const { a, b } = useMemo(() => {
    const slope = modelInfo?.parameters?.slope;
    const intercept = modelInfo?.parameters?.intercept;
    if (Number.isFinite(slope) && Number.isFinite(intercept)) {
      return { a: slope, b: intercept };
    }
    // fallback: OLS on data points (i, fitted)
    const pts = data.filter(d => Number.isFinite(d.fitted));
    const n = pts.length;
    if (n < 2) return { a: 0, b: 0 };
    const sx = pts.reduce((s,p)=>s+p.i,0);
    const sy = pts.reduce((s,p)=>s+p.fitted,0);
    const sxx = pts.reduce((s,p)=>s+p.i*p.i,0);
    const sxy = pts.reduce((s,p)=>s+p.i*p.fitted,0);
    const denom = (n*sxx - sx*sx) || 1;
    const aHat = (n*sxy - sx*sy)/denom;
    const bHat = (sy - aHat*sx)/n;
    return { a: aHat, b: bHat };
  }, [data, modelInfo]);

  // Line endpoints
  const line = useMemo(() => {
    const x0 = 0, x1 = Math.max(1, (history?.length || 1) - 1);
    return [
      { i: x0, y: a*x0 + b },
      { i: x1, y: a*x1 + b },
    ];
  }, [a, b, history?.length]);

  if (!data.length) {
    return <div className="text-sm text-zinc-500">No data for linear regression.</div>;
  }

  return (
    <>
      {/* Header with tiny right label */}
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-sm font-medium">Linear Regression</div>
        <div className="text-xs text-zinc-500">
          {(modelInfo?.type || 'linear')}{' '}
          {Number.isFinite(a) && Number.isFinite(b) ? `• y=${a.toFixed(3)}x + ${b.toFixed(3)}` : ''}
        </div>
      </div>

      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="i" name="Index" />
            <YAxis label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 10 }} />
            <Tooltip />
            <Legend />

            <Scatter name="Actual" dataKey="actual" fill="#0ea5e9" />
            <Line data={line} dataKey="y" name="Regression Line" type="linear" stroke="#16a34a" dot={false} />

            <ReferenceLine y={0} stroke="#e5e7eb" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}