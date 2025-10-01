// frontend/src/pages/analyst/index.jsx
import React, { useState } from 'react';
import DatasetSelector from '../../components/DatasetSelector';
import DatasetAnalytics from '../../components/DatasetAnalytics';

const AdminDashboard = () => {
  const [selectedDataset, setSelectedDataset] = useState('');
  const [filters, setFilters] = useState({
    region: '',
    isComplete: undefined,
  });

  return (
    <div>
      <h2>Analyst Dashboard</h2>

      {/* Dataset selection */}
      <DatasetSelector onSelectDataset={setSelectedDataset} />

      {/* Optional filters */}
      <div>
        <label>
          Region:
          <input
            type="text"
            value={filters.region}
            onChange={(e) => setFilters({ ...filters, region: e.target.value })}
          />
        </label>
        <label>
          Completed:
          <select
            value={filters.isComplete === undefined ? '' : filters.isComplete}
            onChange={(e) => setFilters({ ...filters, isComplete: e.target.value === '' ? undefined : e.target.value === 'true' })}
          >
            <option value="">All</option>
            <option value="true">Completed</option>
            <option value="false">Not Completed</option>
          </select>
        </label>
      </div>

      {/* Display filtered responses */}
      <DatasetAnalytics datasetId={selectedDataset} filters={filters} />
    </div>
  );
};

export default AdminDashboard;
