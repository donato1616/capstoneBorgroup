// frontend/src/pages/admin/Predictive.jsx
import { useEffect, useMemo, useState } from 'react';
import DatasetSelector from '../../components/DatasetSelector';
import { Card } from '../../components/ui';
import LineTimeseries from '../../components/charts/LineTimeseries';
import RegressionChart from '../../components/charts/RegressionChart';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5050';

// Helper function to validate dataset ID
function isValidDatasetId(datasetId) {
  return datasetId && datasetId.length > 0 && datasetId !== 'undefined' && datasetId !== 'null';
}

// Data Validation Component
function ForecastingDiagnostics({ data, numData, catData, mode }) {
  // Add std function if not available
  Math.std = function(arr) {
    if (!arr || arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
  };

  const analyzeDataQuality = (dataset, type) => {
    if (!dataset?.history?.length) return { status: 'No data', issues: [] };
    
    const issues = [];
    const values = dataset.history.map(h => h.actual).filter(v => v != null);
    
    if (values.length < 10) issues.push(`Insufficient data points: ${values.length} (need 10+)`);
    if (values.length >= 2) {
      const variance = Math.std(values);
      if (variance < 0.01) issues.push('Low variance (near-constant values)');
      if (variance === 0) issues.push('Zero variance (all values identical)');
    }
    
    // Check for outliers
    if (values.length >= 5) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const std = Math.std(values);
      const outliers = values.filter(v => Math.abs(v - avg) > 3 * std);
      if (outliers.length > values.length * 0.1) issues.push(`Many outliers: ${outliers.length}/${values.length}`);
    }

    // Check date range and gaps
    if (dataset.history.length >= 2) {
      const dates = dataset.history.map(h => new Date(h.date)).sort((a, b) => a - b);
      const dateRange = (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24);
      if (dateRange < 7) issues.push(`Short time range: ${dateRange.toFixed(1)} days (need 7+ days)`);
      
      // Check for gaps
      let gaps = 0;
      for (let i = 1; i < dates.length; i++) {
        const gap = (dates[i] - dates[i-1]) / (1000 * 60 * 60 * 24);
        if (gap > 3) gaps++;
      }
      if (gaps > dates.length * 0.2) issues.push(`Many date gaps: ${gaps} gaps detected`);
    }
    
    return {
      status: issues.length ? 'Poor' : 'Good',
      dataPoints: values.length,
      dateRange: dataset.history.length ? 
        `${new Date(dataset.history[0].date).toLocaleDateString()} to ${new Date(dataset.history[dataset.history.length-1].date).toLocaleDateString()}` : 'N/A',
      issues
    };
  };

  const getDataForMode = () => {
    switch (mode) {
      case 'respondents': return data;
      case 'numeric': return numData;
      case 'categorical': 
        // For categorical, analyze the first series if available
        if (catData?.series && Object.keys(catData.series).length > 0) {
          const firstSeries = Object.values(catData.series)[0];
          return { history: firstSeries.map(item => ({ date: item.date, actual: item.actual })) };
        }
        return null;
      default: return null;
    }
  };

  const currentData = getDataForMode();
  const analysis = analyzeDataQuality(currentData, mode);

  return (
    <Card className="p-4 bg-blue-50 border-blue-200">
      <div className="text-sm font-medium mb-3">Forecasting Diagnostics</div>
      
      <div className="space-y-4 text-xs">
        <div>
          <div className="font-medium">Current Mode: {mode.toUpperCase()}</div>
          <div className="mt-2">
            <div><strong>Status:</strong> <span className={analysis.status === 'Good' ? 'text-green-600' : 'text-red-600'}>{analysis.status}</span></div>
            <div><strong>Data Points:</strong> {analysis.dataPoints}</div>
            <div><strong>Date Range:</strong> {analysis.dateRange}</div>
          </div>
        </div>
        
        {analysis.issues.length > 0 && (
          <div>
            <div className="font-medium text-amber-700">Issues Detected:</div>
            <ul className="list-disc list-inside ml-2 mt-1">
              {analysis.issues.map((issue, index) => (
                <li key={index} className="text-amber-700">{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {analysis.status === 'Good' && (
          <div className="text-green-700">
            ✓ Data quality is sufficient for forecasting
          </div>
        )}
        
        <div>
          <div className="font-medium">Data Requirements for Good Forecasting:</div>
          <ul className="list-disc list-inside ml-2 mt-1">
            <li>Minimum 10+ data points for time series</li>
            <li>Significant variance in values (not constant)</li>
            <li>Regular time intervals preferred</li>
            <li>Limited missing data/outliers</li>
            <li>At least 7+ days of historical data</li>
          </ul>
        </div>

        {/* Quick Fix Suggestions */}
        {analysis.issues.length > 0 && (
          <div>
            <div className="font-medium text-blue-700">Suggested Actions:</div>
            <ul className="list-disc list-inside ml-2 mt-1">
              {analysis.issues.some(i => i.includes('Insufficient data')) && (
                <li>Collect more data over a longer time period</li>
              )}
              {analysis.issues.some(i => i.includes('variance')) && (
                <li>Check if data aggregation is too coarse - try different intervals</li>
              )}
              {analysis.issues.some(i => i.includes('outliers')) && (
                <li>Review data for anomalies or data entry errors</li>
              )}
              {analysis.issues.some(i => i.includes('date gaps')) && (
                <li>Ensure consistent daily data collection</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

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
    if (!isValidDatasetId(datasetId) || mode !== 'respondents') { 
      setData(null);
      return; 
    }
    
    (async () => {
      try {
        setLoading(true); 
        setErr(''); 
        setData(null);
        const res = await fetch(`${API_BASE}/api/dataset/${datasetId}/predict/regression`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        
        // Check if the data is reliable (no extreme values or NaN)
        if (!data?.metrics?.r2 || !data?.metrics?.rmse) {
          throw new Error('Invalid data returned, metrics missing or NaN.');
        }
  
        setData(data);
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
    if (!isValidDatasetId(datasetId)) { 
      setQSchema([]); 
      setQNum(''); 
      setQCat(''); 
      return; 
    }
    
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/dataset/${datasetId}/questions/schema`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const js = await res.json();
        setQSchema(js.items || []);
        
        // Only set defaults if we have questions
        if (js.items && js.items.length > 0) {
          const firstNum = js.items.find(x => x.kind === 'numeric')?.question || '';
          const firstCat = js.items.find(x => x.kind === 'categorical')?.question || '';
          setQNum(firstNum);
          setQCat(firstCat);
        } else {
          setQNum('');
          setQCat('');
        }
      } catch (e) {
        console.error(e);
        setQSchema([]);
        setQNum('');
        setQCat('');
      }
    })();
  }, [datasetId]);

  // ---------- fetch numeric question forecast ----------
  useEffect(() => {
    if (!isValidDatasetId(datasetId) || !qNum || mode !== 'numeric') { 
      setNumData(null); 
      return; 
    }
    
    (async () => {
      try {
        setNumLoading(true); 
        setNumErr(''); 
        setNumData(null);
        const url = new URL(`${API_BASE}/api/dataset/${datasetId}/predict/question/numeric`);
        url.searchParams.set('questionCode', qNum);
        url.searchParams.set('agg', numAgg);
        url.searchParams.set('interval', numInterval);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const numData = await res.json();
  
        // Validate if data is structured correctly and contains the required fields
        if (!numData?.history?.length || !numData?.horizon?.length) {
          throw new Error('No valid forecast data returned.');
        }
        setNumData(numData);
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
    if (!isValidDatasetId(datasetId) || !qCat || mode !== 'categorical') { 
      setCatData(null); 
      return; 
    }
    
    (async () => {
      try {
        setCatLoading(true); 
        setCatErr(''); 
        setCatData(null);
        const url = new URL(`${API_BASE}/api/dataset/${datasetId}/predict/question/categorical`);
        url.searchParams.set('questionCode', qCat);
        url.searchParams.set('interval', catInterval);
        url.searchParams.set('top_k', String(catTopK));
        url.searchParams.set('as_share', catAsShare ? '1' : '0');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const catData = await res.json();
  
        // Validate if the data has labels and series to render
        if (!catData?.labels?.length || !catData?.series) {
          throw new Error('No valid categorical data returned.');
        }
        setCatData(catData);
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

  // Create a single combined series that properly overlaps all data
  const combinedSeries = useMemo(() => {
    if (mode === 'respondents' && data) {
      const historyData = data.history || [];
      const forecastData = data.horizon || [];
      
      // Create combined series with all three lines
      return [
        { 
          name: 'Actual',  
          data: historyData.map(x => ({ date: x.date, value: x.actual })) 
        },
        { 
          name: 'Fitted',  
          data: historyData.map(x => ({ date: x.date, value: x.fitted })) 
        },
        { 
          name: 'Forecast', 
          data: [
            // Include the last fitted point to connect to forecast
            ...(historyData.length > 0 ? [{
              date: historyData[historyData.length - 1].date,
              value: historyData[historyData.length - 1].fitted
            }] : []),
            // Include all forecast points
            ...forecastData.map(x => ({ date: x.date, value: x.projected }))
          ]
        }
      ];
    }
    return [];
  }, [data, mode]);

  // numeric question series - ensure proper overlap
  const numSeries = useMemo(() => {
    if (!numData?.history || !numData?.horizon) return [];
    
    const historyData = numData.history || [];
    const forecastData = numData.horizon || [];
    
    return [
      { 
        name: 'Actual', 
        data: historyData.map(x => ({ date: x.date, value: x.actual })) 
      },
      { 
        name: 'Fitted', 
        data: historyData.map(x => ({ date: x.date, value: x.fitted })) 
      },
      { 
        name: 'Forecast', 
        data: [
          // Connect forecast to the last fitted point
          ...(historyData.length > 0 ? [{
            date: historyData[historyData.length - 1].date,
            value: historyData[historyData.length - 1].fitted
          }] : []),
          ...forecastData.map(x => ({ date: x.date, value: x.projected }))
        ]
      }
    ];
  }, [numData]);

  // categorical question series (multiple labels) - IMPROVED VERSION
  const catSeries = useMemo(() => {
    if (!catData?.labels?.length || !catData?.series) return [];
    
    const out = [];
    
    // Use the actual category names from the data
    const categories = catData.labels.slice(0, catTopK);
    
    categories.forEach((label, index) => {
      const historyData = catData.series?.[label] || [];
      const forecastData = catData.horizon?.[label] || [];
      
      // Each category gets its own color, with Actual/Fitted/Forecast variations
      out.push({ 
        name: `${label} - Actual`,  
        data: historyData.map(x => ({ date: x.date, value: x.actual })) 
      });
      
      out.push({ 
        name: `${label} - Fitted`,  
        data: historyData.map(x => ({ date: x.date, value: x.fitted })) 
      });
      
      if (forecastData.length) {
        out.push({ 
          name: `${label} - Forecast`, 
          data: [
            // Connect forecast to the last fitted point
            ...(historyData.length > 0 ? [{
              date: historyData[historyData.length - 1].date,
              value: historyData[historyData.length - 1].fitted
            }] : []),
            ...forecastData.map(x => ({ date: x.date, value: x.projected }))
          ]
        });
      }
    });
    
    return out;
  }, [catData, catTopK]);

  const hasTime = (combinedSeries[0]?.data?.length || 0) > 1;

  // Helper function to determine color based on metric performance
  const getMetricColor = (metric, value, baseline = null) => {
    if (value == null) return 'text-zinc-400';
    
    switch (metric) {
      case 'r2':
        return value >= 0.8 ? 'text-green-600' : value >= 0.6 ? 'text-amber-600' : 'text-red-600';
      case 'rmse':
      case 'mse':
      case 'mape':
      case 'smape':
        // For error metrics, lower is better
        if (baseline && value < baseline) return 'text-green-600';
        return value < 0.1 ? 'text-green-600' : value < 0.3 ? 'text-amber-600' : 'text-red-600';
      case 'improvement':
        return value > 0 ? 'text-green-600' : 'text-red-600';
      case 'mase':
        return value < 1 ? 'text-green-600' : value < 2 ? 'text-amber-600' : 'text-red-600';
      default:
        return 'text-zinc-800';
    }
  };

  // ---------------- render ----------------
  return (
    <div className="space-y-4">
      <DatasetSelector onSelectDataset={setDatasetId} />

      {/* Show message when no dataset is selected */}
      {!isValidDatasetId(datasetId) && (
        <Card className="p-4 bg-amber-50 border-amber-200">
          <div className="text-amber-800">
            Please select a dataset to view predictive insights.
          </div>
        </Card>
      )}

      {/* Mode switch - only show when dataset is selected */}
      {isValidDatasetId(datasetId) && (
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
      )}

      {/* ==== KPI row (respondents/day) ==== */}
      {mode === 'respondents' && (
        <div className="grid grid-cols-1 sm:grid-cols-8 gap-3">
          <Card className="p-4">
            <div className="text-xs text-zinc-500">R²</div>
            <div className={`text-2xl font-semibold mt-1 ${getMetricColor('r2', data?.metrics?.r2)}`}>
              {fmt(data?.metrics?.r2)}
            </div>
            <div className="text-xs text-zinc-400 mt-1">Target: ≥0.8 • Perfect: 1.0</div>
          </Card>
          
          <Card className="p-4">
            <div className="text-xs text-zinc-500">MSE</div>
            <div className={`text-2xl font-semibold mt-1 ${getMetricColor('mse', data?.metrics?.mse)}`}>
              {fmt(data?.metrics?.mse)}
            </div>
            <div className="text-xs text-zinc-400 mt-1">Lower is better • Closer to 0</div>
          </Card>
          
          <Card className="p-4">
            <div className="text-xs text-zinc-500">RMSE ({unit})</div>
            <div className={`text-2xl font-semibold mt-1 ${getMetricColor('rmse', data?.metrics?.rmse, data?.metrics?.baseline_rmse)}`}>
              {fmt(data?.metrics?.rmse)}
            </div>
            <div className="text-xs text-zinc-400 mt-1">
              Baseline: {fmt(data?.metrics?.baseline_rmse)} • Lower is better
            </div>
          </Card>
          
          <Card className="p-4">
            <div className="text-xs text-zinc-500">Baseline RMSE ({unit})</div>
            <div className="text-2xl font-semibold mt-1 text-zinc-800">
              {fmt(data?.metrics?.baseline_rmse)}
            </div>
            <div className="text-xs text-zinc-400 mt-1">Simple forecast baseline • Compare to model RMSE</div>
          </Card>
          
          <Card className="p-4">
            <div className="text-xs text-zinc-500">MASE</div>
            <div className={`text-2xl font-semibold mt-1 ${getMetricColor('mase', data?.metrics?.mase)}`}>
              {fmt(data?.metrics?.mase)}
            </div>
            <div className="text-xs text-zinc-400 mt-1">Target: &lt;1 • Better than naive forecast</div>
          </Card>
          
          <Card className="p-4">
            <div className="text-xs text-zinc-500">Improvement vs Baseline</div>
            <div className={`text-2xl font-semibold mt-1 ${getMetricColor('improvement', data?.metrics?.improvement_vs_baseline)}`}>
              {data?.metrics?.improvement_vs_baseline == null ? '—' : `${(data.metrics.improvement_vs_baseline * 100).toFixed(1)}%`}
            </div>
            <div className="text-xs text-zinc-400 mt-1">Positive = Better than baseline • Higher is better</div>
          </Card>
          
          <Card className="p-4">
            <div className="text-xs text-zinc-500">MAPE</div>
            <div className={`text-2xl font-semibold mt-1 ${getMetricColor('mape', data?.metrics?.mape)}`}>
              {data?.metrics?.mape == null ? '—' : `${(data.metrics.mape * 100).toFixed(1)}%`}
            </div>
            <div className="text-xs text-zinc-400 mt-1">Target: &lt;10% • Lower is better</div>
          </Card>
          
          <Card className="p-4">
            <div className="text-xs text-zinc-500">sMAPE (bounded)</div>
            <div className={`text-2xl font-semibold mt-1 ${getMetricColor('smape', data?.metrics?.smape)}`}>
              {data?.metrics?.smape == null ? '—' : `${(data.metrics.smape * 100).toFixed(1)}%`}
            </div>
            <div className="text-xs text-zinc-400 mt-1">Symmetric MAPE • Target: &lt;10%</div>
          </Card>
          
          <Card className="p-4">
            <div className="text-xs text-zinc-500">MAPE (≥5)</div>
            <div className={`text-2xl font-semibold mt-1 ${getMetricColor('mape', data?.metrics?.mape_floor5)}`}>
              {data?.metrics?.mape_floor5 == null ? '—' : `${(data.metrics.mape_floor5 * 100).toFixed(1)}%`}
            </div>
            <div className="text-xs text-zinc-400 mt-1">Filtered for values ≥5 • Lower is better</div>
          </Card>
        </div>
      )}

      {/* ==== Respondents charts ==== */}
      {mode === 'respondents' && (
        <>
          <Card className="p-4">
            <div className="text-sm font-medium mb-2">7-Day Forecast - All Series Overlapping</div>
            {loading && <div className="text-sm text-zinc-500">Computing…</div>}
            {!loading && err && <div className="text-sm text-rose-600">Error: {err}</div>}
            {!loading && !err && !hasTime
              ? <div className="text-sm text-zinc-500">Insufficient dated history to fit a model.</div>
              : (
                <>
                  <LineTimeseries 
                    series={combinedSeries} 
                    yLabel={unit}
                    xLabel="Date"
                  />
                  <div className="mt-3 text-xs text-zinc-500 grid grid-cols-3 gap-2">
                    <div><span className="inline-block w-3 h-3 bg-[#0ea5e9] mr-1"></span> Actual: Historical data points</div>
                    <div><span className="inline-block w-3 h-3 bg-[#6366f1] mr-1"></span> Fitted: Model predictions for historical period</div>
                    <div><span className="inline-block w-3 h-3 bg-[#f59e0b] mr-1 border border-amber-600"></span> Forecast: 7-day future projections</div>
                  </div>
                </>
              )
            }
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card className="p-4">
              <div className="text-xs text-zinc-500">OOS RMSE ({unit})</div>
              <div className={`text-2xl font-semibold mt-1 ${getMetricColor('rmse', data?.metrics?.oos_rmse)}`}>
                {fmt(data?.metrics?.oos_rmse)}
              </div>
              <div className="text-xs text-zinc-400 mt-1">Out-of-sample error • Lower is better</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-zinc-500">OOS R²</div>
              <div className={`text-2xl font-semibold mt-1 ${getMetricColor('r2', data?.metrics?.oos_r2)}`}>
                {fmt(data?.metrics?.oos_r2)}
              </div>
              <div className="text-xs text-zinc-400 mt-1">Out-of-sample fit • Target: ≥0.8</div>
            </Card>
          </div>
        </>
      )}

      {/* ==== Numeric question section ==== */}
      {mode === 'numeric' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <Card className="p-4">
              <div className="text-xs text-zinc-500">R²</div>
              <div className={`text-2xl font-semibold mt-1 ${getMetricColor('r2', numData?.metrics?.r2)}`}>
                {fmt(numData?.metrics?.r2)}
              </div>
              <div className="text-xs text-zinc-400 mt-1">Target: ≥0.8 • Perfect: 1.0</div>
            </Card>
            
            <Card className="p-4">
              <div className="text-xs text-zinc-500">RMSE</div>
              <div className={`text-2xl font-semibold mt-1 ${getMetricColor('rmse', numData?.metrics?.rmse, numData?.metrics?.baseline_rmse)}`}>
                {fmt(numData?.metrics?.rmse)}
              </div>
              <div className="text-xs text-zinc-400 mt-1">
                Baseline: {fmt(numData?.metrics?.baseline_rmse)} • Lower is better
              </div>
            </Card>
            
            <Card className="p-4">
              <div className="text-xs text-zinc-500">Baseline RMSE</div>
              <div className="text-2xl font-semibold mt-1 text-zinc-800">
                {fmt(numData?.metrics?.baseline_rmse)}
              </div>
              <div className="text-xs text-zinc-400 mt-1">Simple forecast baseline • Compare to model RMSE</div>
            </Card>
            
            <Card className="p-4">
              <div className="text-xs text-zinc-500">sMAPE</div>
              <div className={`text-2xl font-semibold mt-1 ${getMetricColor('smape', numData?.metrics?.smape)}`}>
                {numData?.metrics?.smape == null ? '—' : `${(numData.metrics.smape * 100).toFixed(1)}%`}
              </div>
              <div className="text-xs text-zinc-400 mt-1">Symmetric MAPE • Target: &lt;10%</div>
            </Card>
            
            <Card className="p-4">
              <div className="text-xs text-zinc-500">MAPE (≥5)</div>
              <div className={`text-2xl font-semibold mt-1 ${getMetricColor('mape', numData?.metrics?.mape_floor5)}`}>
                {numData?.metrics?.mape_floor5 == null ? '—' : `${(numData.metrics.mape_floor5 * 100).toFixed(1)}%`}
              </div>
              <div className="text-xs text-zinc-400 mt-1">Filtered for values ≥5 • Lower is better</div>
            </Card>
          </div>

          <Card className="p-4">
            <div className="text-sm font-medium mb-2">{qNum ? `${qNum} (${numAgg} per ${numInterval})` : 'Choose a numeric question'}</div>
            {numLoading && <div className="text-sm text-zinc-500">Computing…</div>}
            {!numLoading && numErr && <div className="text-sm text-rose-600">Error: {numErr}</div>}
            {!numLoading && !numErr && (!numData?.history?.length)
              ? <div className="text-sm text-zinc-500">No data detected for this question/interval.</div>
              : (
                <>
                  <LineTimeseries 
                    series={numSeries} 
                    yLabel={`${numAgg} value`}
                    xLabel="Date"
                  />
                  <div className="mt-3 text-xs text-zinc-500 grid grid-cols-3 gap-2">
                    <div><span className="inline-block w-3 h-3 bg-[#0ea5e9] mr-1"></span> Actual: Historical values</div>
                    <div><span className="inline-block w-3 h-3 bg-[#6366f1] mr-1"></span> Fitted: Model predictions</div>
                    <div><span className="inline-block w-3 h-3 bg-[#f59e0b] mr-1 border border-amber-600"></span> Forecast: Future projections</div>
                  </div>
                </>
              )
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
              : (
                <>
                  <LineTimeseries 
                    series={catSeries} 
                    yLabel={catAsShare ? 'Percentage Share' : 'Response Count'}
                    xLabel="Date"
                  />
                  <div className="mt-3 text-xs text-zinc-500">
                    <div><span className="inline-block w-3 h-3 bg-[#0ea5e9] mr-1"></span> Actual: Historical response patterns</div>
                    <div><span className="inline-block w-3 h-3 bg-[#6366f1] mr-1"></span> Fitted: Model predictions for each category</div>
                    <div><span className="inline-block w-3 h-3 bg-[#f59e0b] mr-1 border border-amber-600"></span> Forecast: Future category trends</div>
                  </div>
                </>
              )
            }
          </Card>
        </>
      )}

      {/* Data Validation Diagnostics - Always show when we have data */}
      {(data || numData || catData) && (
        <ForecastingDiagnostics 
          data={data} 
          numData={numData} 
          catData={catData} 
          mode={mode} 
        />
      )}
    </div>
  );
}