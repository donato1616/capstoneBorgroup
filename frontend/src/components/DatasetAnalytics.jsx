// frontend/src/components/DatasetAnalytics.jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE =
  import.meta?.env?.VITE_API_URL?.replace(/\/+$/, '') || 'http://localhost:5000';

const DatasetAnalytics = ({ datasetId, filters }) => {
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    if (!datasetId) return;

    const controller = new AbortController();
    const fetchData = async () => {
      setLoading(true);
      setErrMsg('');
      try {
        // Build query params for filtering
        const params = {};
        if (filters?.region) params.region = filters.region;
        if (filters?.isComplete !== undefined) params.isComplete = filters.isComplete;
        if (filters?.startDate) params.startDate = filters.startDate;
        if (filters?.endDate) params.endDate = filters.endDate;

        const url = `${API_BASE}/api/analytics/${datasetId}`;
        const res = await axios.get(url, { params, signal: controller.signal });

        // Backend returns: { responses: [{ id, businessKey, region, isComplete, submittedAt, surveyor, durationSec, answers }] }
        const rows = Array.isArray(res.data?.responses) ? res.data.responses : [];

        const shaped = rows.map((r) => {
          const submitted = r.submittedAt ? new Date(r.submittedAt) : null;
          const interviewerName =
            r?.answers?.interviewer_full_name ||
            r?.answers?.interviewerName ||
            r?.surveyor ||
            null;

          return {
            id: r.id,
            respondentId: r.businessKey ?? '',
            interviewer: interviewerName ? { fullName: String(interviewerName) } : null,
            startDate: submitted ? submitted.toISOString() : '',
            startHour: submitted ? submitted.toTimeString().slice(0, 5) : '',
            status: r.isComplete ? 'Completed' : 'Incomplete',
            region: r.region ?? '—',
          };
        });

        setResponses(shaped);
      } catch (err) {
        const status = err?.response?.status;
        if (status === 404) {
          setResponses([]); // tolerant to missing route while you wire backend
        } else if (axios.isCancel(err)) {
          // ignore
        } else {
          console.error('Error fetching responses:', err);
          setErrMsg('Failed to load responses');
          setResponses([]);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    return () => controller.abort();
  }, [datasetId, filters]);

  if (!datasetId) return <p>Please select a dataset to view responses.</p>;

  return (
    <div>
      <h3>Responses for Dataset {datasetId}</h3>

      {loading && <p>Loading…</p>}
      {!loading && errMsg && <p style={{ color: 'crimson' }}>{errMsg}</p>}
      {!loading && !errMsg && responses.length === 0 && (
        <p>No responses match your filters.</p>
      )}

      {responses.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Respondent ID</th>
              <th>Interviewer</th>
              <th>Start Date</th>
              <th>Start Hour</th>
              <th>Status</th>
              <th>Region</th>
            </tr>
          </thead>
          <tbody>
            {responses.map((r) => (
              <tr key={r.id}>
                <td>{r.respondentId}</td>
                <td>{r.interviewer?.fullName || 'N/A'}</td>
                <td>{r.startDate ? new Date(r.startDate).toLocaleDateString() : '—'}</td>
                <td>{r.startHour || '—'}</td>
                <td>{r.status}</td>
                <td>{r.region}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default DatasetAnalytics;
