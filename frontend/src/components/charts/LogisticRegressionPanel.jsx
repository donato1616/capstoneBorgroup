// LogisticRegressionPanel.jsx
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

// tiny logistic fit (binary y, single feature x) via gradient descent
function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

function fitLogistic(X, y, { lr = 0.01, iters = 800 } = {}) {
  let b0 = 0, b1 = 0;
  const n = X.length || 1;
  for (let t = 0; t < iters; t++) {
    let g0 = 0, g1 = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(b0 + b1 * X[i]);
      const e = p - y[i];
      g0 += e;
      g1 += e * X[i];
    }
    b0 -= (lr * g0) / n;
    b1 -= (lr * g1) / n;
  }
  return { b0, b1 };
}

/**
 * Builds a simple binary target from a continuous series:
 *  y := 1 if actual >= median(actual), else 0
 */
export default function LogisticRegressionPanel({
  history = [],          // [{date, actual}]
  xMode = 'index',       // 'index' | 'value'
}) {
  const prepared = useMemo(() => {
    const vals = (history || [])
      .map((d,i) => ({ xIndex: i, xVal: d.actual ?? 0, actual: d.actual ?? 0 }))
      .filter(d => Number.isFinite(d.actual));

    if (!vals.length) return { data: [], curve: [], threshold: null };

    // feature X
    const X = vals.map(v => (xMode === 'value' ? v.xVal : v.xIndex));

    // binary y using median threshold
    const sorted = [...vals.map(v => v.actual)].sort((a,b)=>a-b);
    const mid = sorted[Math.floor(sorted.length/2)];
    const y = vals.map(v => (v.actual >= mid ? 1 : 0));

    // fit
    const { b0, b1 } = fitLogistic(X, y);

    // curve across the range
    const minX = Math.min(...X);
    const maxX = Math.max(...X);
    const step = (maxX - minX) / 80 || 1;
    const curve = [];
    for (let xx = minX; xx <= maxX; xx += step) {
      curve.push({ x: xx, p: sigmoid(b0 + b1*xx) });
    }

    // points for scatter
    const data = vals.map((v, i) => ({
      x: X[i],
      y: y[i],
    }));

    return { data, curve, threshold: mid, b0, b1 };
  }, [history, xMode]);

  if (!prepared.data.length) {
    return <div className="text-sm text-zinc-500">Not enough data for a logistic view.</div>;
  }

  return (
    <>
      {/* Header with tiny right label */}
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-sm font-medium">Logistic Regression</div>
        <div className="text-xs text-zinc-500">
          {`x=${xMode}; threshold≈${Number(prepared.threshold).toFixed(2)}`}
        </div>
      </div>

      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="x" type="number" name="X" />
            <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} />
            <Tooltip />
            <Legend />

            <Scatter name="Observed (0/1)" data={prepared.data} fill="#0ea5e9" />
            <Line
              name="Logistic fit"
              data={prepared.curve}
              dataKey="p"
              type="monotone"
              stroke="#f59e0b"
              dot={false}
            />
            <ReferenceLine y={0.5} stroke="#9ca3af" strokeDasharray="4 4" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 text-xs text-zinc-500">
        Binary target uses median(actual) threshold. The orange curve is the fitted probability.
      </div>
    </>
  );
}