// frontend/src/components/DatasetAnalytics.jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const DatasetAnalytics = ({ datasetId, filters }) => {
  const [responses, setResponses] = useState([]);

  useEffect(() => {
    if (!datasetId) return;

    // Build query params for filtering
    const params = {};
    if (filters?.region) params.region = filters.region;
    if (filters?.isComplete !== undefined) params.isComplete = filters.isComplete;
    if (filters?.startDate) params.startDate = filters.startDate;
    if (filters?.endDate) params.endDate = filters.endDate;

    axios.get(`http://localhost:5000/api/analytics/${datasetId}`, { params })
      .then((res) => setResponses(res.data.responses))
      .catch((err) => console.error('Error fetching responses:', err));
  }, [datasetId, filters]);

  if (!datasetId) return <p>Please select a dataset to view responses.</p>;

  return (
    <div>
      <h3>Responses for Dataset {datasetId}</h3>
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
              <td>{new Date(r.startDate).toLocaleDateString()}</td>
              <td>{r.startHour}</td>
              <td>{r.status}</td>
              <td>{r.region}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default DatasetAnalytics;
