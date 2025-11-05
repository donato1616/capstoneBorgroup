// frontend/src/components/DatasetAnalytics.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE, fetchDatasetSummary, fetchQDist } from '../api';

const Card = ({ title, value, sub }) => (
  <div className="rounded-xl border p-4">
    <div className="text-xs text-zinc-500">{title}</div>
    <div className="text-2xl font-semibold mt-1">{value}</div>
    {sub ? <div className="text-[11px] text-zinc-500 mt-1">{sub}</div> : null}
  </div>
);

export default function DatasetAnalytics({ datasetId }) {
  const [summary, setSummary] = useState(null);
  const [qcode, setQcode] = useState('');
  const [qdist, setQdist] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!datasetId) return;
    setLoading(true);
    setQdist(null);
    fetchDatasetSummary(datasetId)
      .then((s) => {
        setSummary(s);
        // preselect the top question if present
        if (s?.top_questions?.length) setQcode(s.top_questions[0].question);
        const firstQ = s?.top_questions?.[0]?.question;
        setQcode(firstQ || '');
      })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [datasetId]);

  useEffect(() => {
    if (!datasetId || !qcode) return;
    fetchQDist(datasetId, qcode)
      .then(setQdist)
      .catch((e) => console.error(e));
  }, [datasetId, qcode]);

  if (!datasetId) return <p>Please select a dataset.</p>;
  if (loading && !summary) return <p>Loading...</p>;
  if (!summary) return <p>No summary available.</p>;

  const regionTop = (summary.by_region || []).slice(0, 5);
  const questions = summary.top_questions || [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card title="Respondents" value={summary.respondent_count || 0} />
        <Card title="Facts Indexed" value={summary.fact_count || 0} />
        <Card
          title="Top Region"
          value={regionTop[0]?.region || 'N/A'}
          sub={regionTop[0] ? `${regionTop[0].c} facts` : ''}
        />
      </div>

      <div className="rounded-xl border p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Regions, top 5</div>
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-3">
          {regionTop.map((r) => (
            <div key={r.region} className="rounded-lg border p-3">
              <div className="text-xs text-zinc-500 truncate">{r.region}</div>
              <div className="text-lg font-semibold">{r.c}</div>
            </div>
          ))}
          {!regionTop.length && <div className="text-sm text-zinc-500">No region data.</div>}
        </div>
      </div>

      <div className="rounded-xl border p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-sm font-medium">Question Distribution</div>
          <select
            className="border rounded-lg px-2 py-1 text-sm"
            value={qcode}
            onChange={(e) => setQcode(e.target.value)}
          >
            {questions.map((q) => (
              <option key={q.question} value={q.question}>{q.question} ({q.c})</option>
            ))}
          </select>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Numeric bins */}
          <div className="rounded-lg border p-3">
            <div className="text-xs text-zinc-500 mb-2">Numeric bins</div>
            {qdist?.numeric_bins?.length ? (
              <ul className="space-y-1 text-sm">
                {qdist.numeric_bins.map((b, idx) => (
                  <li key={idx} className="flex items-center justify-between">
                    <span>[{Number(b.lo).toFixed(2)} - {Number(b.hi).toFixed(2)}]</span>
                    <span className="font-medium">{b.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-zinc-500">No numeric data.</div>
            )}
          </div>

          {/* Top text answers */}
          <div className="rounded-lg border p-3">
            <div className="text-xs text-zinc-500 mb-2">Top text answers</div>
            {qdist?.text_top?.length ? (
              <ul className="space-y-1 text-sm max-h-56 overflow-auto">
                {qdist.text_top.map((t) => (
                  <li key={t.label} className="flex items-center justify-between">
                    <span className="truncate pr-2">{t.label}</span>
                    <span className="font-medium">{t.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-zinc-500">No text data.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
