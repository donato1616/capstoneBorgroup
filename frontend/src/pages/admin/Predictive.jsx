// frontend/src/pages/admin/Predictive.jsx
import { useEffect, useMemo, useState } from 'react';
import DatasetSelector from '../../components/DatasetSelector';
import { Card } from '../../components/ui';
import LineTimeseries from '../../components/charts/LineTimeseries';
import RegressionChart from '../../components/charts/RegressionChart';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5050';

export default function PredictiveInsights() {
  const [datasetId, setDatasetId] = useState('');

  // mode: respondents vs question-level
  const [mode, setMode] = useState('respondents'); // 'respondents' | 'numeric' | 'categorical'

  // respondents/day data
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // question schema & selections
  const [qSchema, setQSchema] = useState([]);
  const [qNum, setQNum] = useState('');      // numeric questionCode
  const [qCat, setQCat] = useState('');      // categorical questionCode

  // numeric controls
  const [numAgg, setNumAgg] = useState('avg');       // sum|avg|count
  const [numInterval, setNumInterval] = useState('day'); // day|week|month
  const [numData, setNumData] = useState(null);
  const [numLoading, setNumLoading] = useState(false);
  const [numErr, setNumErr] = useState('');

  // categorical controls
  const [catInterval, setCatInterval] = useState('day');
  const [catTopK, setCatTopK] = useState(3);
  const [catAsShare, setCatAsShare] = useState(false);
  const [catData, setCatData] = useState(null);
  const [catLoading, setCatLoading] = useState(false);
  const [catErr, setCatErr] = useState('');

  // ---------- fetch respondents/day regression ----------
  useEffect(() => {
    if (!datasetId || mode !== 'respondents') { return; }
    (async () => {
      try {
        setLoading(true); setErr(''); setData(null);
        const res = await fetch(`${API_BASE}/api/dataset/${datasetId}/predict/regression`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json());
      } catch (e) {
        console.error(e);
        setErr(e.message || 'Failed to load dataset');
      } finally {
        setLoading(false);
      }
    })();
  }, [datasetId, mode]);

  // ---------- fetch question schema whenever dataset changes ----------
  useEffect(() => {
    if (!datasetId) { setQSchema([]); setQNum(''); setQCat(''); return; }
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/dataset/${datasetId}/questions/schema`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const js = await res.json();
        setQSchema(js.items || []);
        const firstNum = (js.items || []).find(x => x.kind === 'numeric')?.question || '';
        const firstCat = (js.items || []).find(x => x.kind === 'categorical')?.question || '';
        setQNum(firstNum || '');
        setQCat(firstCat || '');
      } catch (e) {
        console.error(e);
        setQSchema([]);
      }
    })();
  }, [datasetId]);

  // ---------- fetch numeric question forecast ----------
  useEffect(() => {
    if (!datasetId || !qNum || mode !== 'numeric') { setNumData(null); return; }
    (async () => {
      try {
        setNumLoading(true); setNumErr(''); setNumData(null);
        const url = new URL(`${API_BASE}/api/dataset/${datasetId}/predict/question/numeric`);
        url.searchParams.set('questionCode', qNum);
        url.searchParams.set('agg', numAgg);
        url.searchParams.set('interval', numInterval);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setNumData(await res.json());
      } catch (e) {
        console.error(e);
        setNumErr(e.message || 'Failed to load numeric forecast');
      } finally {
        setNumLoading(false);
      }
    })();
  }, [datasetId, qNum, numAgg, numInterval, mode]);

  // ---------- fetch categorical question forecast ----------
  useEffect(() => {
    if (!datasetId || !qCat || mode !== 'categorical') { setCatData(null); return; }
    (async () => {
      try {
        setCatLoading(true); setCatErr(''); setCatData(null);
        const url = new URL(`${API_BASE}/api/dataset/${datasetId}/predict/question/categorical`);
        url.searchParams.set('questionCode', qCat);
        url.searchParams.set('interval', catInterval);
        url.searchParams.set('top_k', String(catTopK));
        url.searchParams.set('as_share', catAsShare ? '1' : '0');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setCatData(await res.json());
      } catch (e) {
        console.error(e);
        setCatErr(e.message || 'Failed to load categorical forecast');
      } finally {
        setCatLoading(false);
      }
    })();
  }, [datasetId, qCat, catInterval, catTopK, catAsShare, mode]);

  // ---------------- common helpers ----------------
  const fmt = (v, d = 3) => (v == null ? '—' : Number(v).toFixed(d));
  const unit   = data?.unit || 'respondents/day';

  // respondents/day series (for your existing charts)
  const historySeries = useMemo(() => {
    if (!data?.history?.length) return [];
    return [
      { name: 'Actual',  data: data.history.map(x => ({ date: x.date, value: x.actual })) },
      { name: 'Fitted',  data: data.history.map(x => ({ date: x.date, value: x.fitted })) },
    ];
  }, [data]);

  const forecastSeries = useMemo(() => {
    if (!data?.horizon?.length) return [];
    return [{ name: 'Forecast', data: data.horizon.map(x => ({ date: x.date, value: x.projected })) }];
  }, [data]);

  const hasTime = ((historySeries[0]?.data?.length || 0) > 1) || (forecastSeries[0]?.data?.length || 0) > 0;

  // numeric question series
  const numSeries = useMemo(() => {
    if (!numData?.history) return [];
    const hist = [
      { name: 'Actual', data: numData.history.map(x => ({ date: x.date, value: x.actual })) },
      { name: 'Fitted', data: numData.history.map(x => ({ date: x.date, value: x.fitted })) },
    ];
    const f = (numData.horizon || []).map(x => ({ date: x.date, value: x.projected }));
    return f.length ? [...hist, { name: 'Forecast', data: f }] : hist;
  }, [numData]);

  // categorical question series (multiple labels)
  const catSeries = useMemo(() => {
    if (!catData?.labels?.length) return [];
    const out = [];
    for (const label of catData.labels.slice(0, catTopK)) {
      const s = catData.series?.[label] || [];
      const h = catData.horizon?.[label] || [];
      out.push({ name: `Actual: ${label}`,  data: s.map(x => ({ date: x.date, value: x.actual })) });
      out.push({ name: `Fitted: ${label}`,  data: s.map(x => ({ date: x.date, value: x.fitted })) });
      if (h.length) out.push({ name: `Forecast: ${label}`, data: h.map(x => ({ date: x.date, value: x.projected })) });
    }
    return out;
  }, [catData, catTopK]);

  // ---------------- render ----------------
  return (
    <div className="space-y-4">
      <DatasetSelector onSelectDataset={setDatasetId} />

      {/* Mode switch */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="text-sm font-medium">Mode:</div>
          <select className="border rounded px-2 py-1"
                  value={mode}
                  onChange={e => setMode(e.target.value)}>
            <option value="respondents">Respondents / day (current)</option>
            <option value="numeric">Numeric Question forecast</option>
            <option value="categorical">Categorical/Text Question forecast</option>
          </select>

          {/* Numeric controls */}
          {mode === 'numeric' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="ml-2 text-sm">Question:</span>
              <select className="border rounded px-2 py-1"
                      value={qNum}
                      onChange={e => setQNum(e.target.value)}>
                <option value="">— choose numeric —</option>
                {qSchema.filter(x=>x.kind==='numeric').map(x=>(
                <option key={x.question} value={x.question}>{x.label || x.question}</option>
                ))}
              </select>
              <span className="text-sm">Agg:</span>
              <select className="border rounded px-2 py-1" value={numAgg} onChange={e=>setNumAgg(e.target.value)}>
                <option value="avg">avg</option><option value="sum">sum</option><option value="count">count</option>
              </select>
              <span className="text-sm">Interval:</span>
              <select className="border rounded px-2 py-1" value={numInterval} onChange={e=>setNumInterval(e.target.value)}>
                <option value="day">day</option><option value="week">week</option><option value="month">month</option>
              </select>
            </div>
          )}

          {/* Categorical controls */}
          {mode === 'categorical' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="ml-2 text-sm">Question:</span>
              <select className="border rounded px-2 py-1"
                      value={qCat}
                      onChange={e => setQCat(e.target.value)}>
                <option value="">— choose categorical —</option>
              {qSchema.filter(x=>x.kind==='categorical').map(x=>(
                <option key={x.question} value={x.question}>{x.label || x.question}</option>
              ))}
              </select>
              <span className="text-sm">Top-K:</span>
              <input className="border rounded px-2 py-1 w-16" type="number" min="1" max="10"
                     value={catTopK} onChange={e=>setCatTopK(Number(e.target.value || 1))}/>
              <span className="text-sm">Interval:</span>
              <select className="border rounded px-2 py-1" value={catInterval} onChange={e=>setCatInterval(e.target.value)}>
                <option value="day">day</option><option value="week">week</option><option value="month">month</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={catAsShare} onChange={e=>setCatAsShare(e.target.checked)} />
                Show as share (%)
              </label>
            </div>
          )}
        </div>
      </Card>

      {/* ==== KPI row (respondents/day) ==== */}
      {mode === 'respondents' && (
        <div className="grid grid-cols-1 sm:grid-cols-8 gap-3">
          <Card className="p-4"><div className="text-xs text-zinc-500">R²</div><div className="text-2xl font-semibold mt-1">{fmt(data?.metrics?.r2)}</div></Card>
          <Card className="p-4"><div className="text-xs text-zinc-500">MSE</div><div className="text-2xl font-semibold mt-1">{fmt(data?.metrics?.mse)}</div></Card>
          <Card className="p-4"><div className="text-xs text-zinc-500">RMSE ({unit})</div><div className="text-2xl font-semibold mt-1">{fmt(data?.metrics?.rmse)}</div></Card>
          <Card className="p-4"><div className="text-xs text-zinc-500">Baseline RMSE ({unit})</div><div className="text-2xl font-semibold mt-1">{fmt(data?.metrics?.baseline_rmse)}</div></Card>
          <Card className="p-4"><div className="text-xs text-zinc-500">Improvement vs Baseline</div><div className="text-2xl font-semibold mt-1">{data?.metrics?.improvement_vs_baseline == null ? '—' : `${(data.metrics.improvement_vs_baseline * 100).toFixed(1)}%`}</div></Card>
          <Card className="p-4"><div className="text-xs text-zinc-500">MAPE</div><div className="text-2xl font-semibold mt-1">{data?.metrics?.mape == null ? '—' : `${(data.metrics.mape * 100).toFixed(1)}%`}</div></Card>
          <Card className="p-4"><div className="text-xs text-zinc-500">sMAPE (bounded)</div><div className="text-2xl font-semibold mt-1">{data?.metrics?.smape == null ? '—' : `${(data.metrics.smape * 100).toFixed(1)}%`}</div></Card>
          <Card className="p-4"><div className="text-xs text-zinc-500">MAPE (≥5)</div><div className="text-2xl font-semibold mt-1">{data?.metrics?.mape_floor5 == null ? '—' : `${(data.metrics.mape_floor5 * 100).toFixed(1)}%`}</div></Card>
        </div>
      )}

      {/* ==== Respondents charts ==== */}
      {mode === 'respondents' && (
        <>
          <Card className="p-4">
            <div className="text-sm font-medium mb-2">7-Day Forecast (Simple)</div>
            {loading && <div className="text-sm text-zinc-500">Computing…</div>}
            {!loading && err && <div className="text-sm text-rose-600">Error: {err}</div>}
            {!loading && !err && !hasTime
              ? <div className="text-sm text-zinc-500">Insufficient dated history to fit a model.</div>
              : <LineTimeseries series={[...historySeries, ...forecastSeries]} />
            }
          </Card>

          <Card className="p-4">
            <div className="text-sm font-medium mb-2">7-Day Forecast (Detailed with Baseline)</div>
            {loading && <div className="text-sm text-zinc-500">Computing…</div>}
            {!loading && err && <div className="text-sm text-rose-600">Error: {err}</div>}
            {!loading && !err && hasTime && (
              <RegressionChart history={data?.history || []} horizon={data?.horizon || []} unit={unit} />
            )}
            {!loading && !err && !hasTime && (
              <div className="text-sm text-zinc-500">Insufficient dated history to fit a model.</div>
            )}
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card className="p-4">
              <div className="text-xs text-zinc-500">OOS RMSE ({unit})</div>
              <div className="text-2xl font-semibold mt-1">{fmt(data?.metrics?.oos_rmse)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-zinc-500">OOS R²</div>
              <div className="text-2xl font-semibold mt-1">{fmt(data?.metrics?.oos_r2)}</div>
            </Card>
          </div>
        </>
      )}

      {/* ==== Numeric question section ==== */}
      {mode === 'numeric' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <Card className="p-4"><div className="text-xs text-zinc-500">R²</div><div className="text-2xl font-semibold mt-1">{fmt(numData?.metrics?.r2)}</div></Card>
            <Card className="p-4"><div className="text-xs text-zinc-500">RMSE</div><div className="text-2xl font-semibold mt-1">{fmt(numData?.metrics?.rmse)}</div></Card>
            <Card className="p-4"><div className="text-xs text-zinc-500">Baseline RMSE</div><div className="text-2xl font-semibold mt-1">{fmt(numData?.metrics?.baseline_rmse)}</div></Card>
            <Card className="p-4"><div className="text-xs text-zinc-500">sMAPE</div><div className="text-2xl font-semibold mt-1">{numData?.metrics?.smape == null ? '—' : `${(numData.metrics.smape * 100).toFixed(1)}%`}</div></Card>
            <Card className="p-4"><div className="text-xs text-zinc-500">MAPE (≥5)</div><div className="text-2xl font-semibold mt-1">{numData?.metrics?.mape_floor5 == null ? '—' : `${(numData.metrics.mape_floor5 * 100).toFixed(1)}%`}</div></Card>
          </div>

          <Card className="p-4">
            <div className="text-sm font-medium mb-2">{qNum ? `${qNum} (${numAgg} per ${numInterval})` : 'Choose a numeric question'}</div>
            {numLoading && <div className="text-sm text-zinc-500">Computing…</div>}
            {!numLoading && numErr && <div className="text-sm text-rose-600">Error: {numErr}</div>}
            {!numLoading && !numErr && (!numData?.history?.length)
              ? <div className="text-sm text-zinc-500">No data detected for this question/interval.</div>
              : <LineTimeseries series={numSeries} />
            }
          </Card>
        </>
      )}

      {/* ==== Categorical question section ==== */}
      {mode === 'categorical' && (
        <>
          <Card className="p-4">
            <div className="text-sm font-medium mb-2">{qCat ? `${qCat} (${catAsShare ? 'share' : 'count'} per ${catInterval})` : 'Choose a categorical question'}</div>
            {catLoading && <div className="text-sm text-zinc-500">Computing…</div>}
            {!catLoading && catErr && <div className="text-sm text-rose-600">Error: {catErr}</div>}
            {!catLoading && !catErr && (!catData?.labels?.length)
              ? <div className="text-sm text-zinc-500">No top labels detected for this question.</div>
              : <LineTimeseries series={catSeries} />
            }
          </Card>
        </>
      )}
    </div>
  );
}