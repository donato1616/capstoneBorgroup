import React, { useState, useEffect } from 'react';

const DatasetSelector = ({ onSelectDataset }) => {
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchDatasets = async () => {
      try {
        setLoading(true);
        setError('');

        const res = await fetch(`/api/datasets`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

        const data = await res.json();

        if (Array.isArray(data) && data.length > 0) {
          setDatasets(data);
          setSelectedDataset(data[0].dataset_id);
          onSelectDataset(data[0].dataset_id);
        } else {
          setDatasets([]);
          setError('No datasets found');
        }
      } catch (err) {
        console.error('Error fetching datasets:', err);
        setError('Failed to load datasets');
        setDatasets([]);
      } finally {
        setLoading(false);
      }
    };

    fetchDatasets();
  }, [onSelectDataset]);

  const handleChange = (e) => {
    const id = e.target.value;
    setSelectedDataset(id);
    onSelectDataset(id);
  };

  return (
    <div className="dataset-selector">
      <label htmlFor="dataset-select" className="mr-2 font-medium">Select Dataset:</label>
      {loading ? (
        <span className="text-gray-500">Loading datasets...</span>
      ) : error ? (
        <span className="text-red-500">{error}</span>
      ) : (
        <select
          id="dataset-select"
          value={selectedDataset}
          onChange={handleChange}
          className="border rounded px-2 py-1"
        >
          <option value="">-- Choose a dataset --</option>
          {datasets.map(d => (
            <option key={d.dataset_id} value={d.dataset_id}>{d.name}</option>
          ))}
        </select>
      )}
    </div>
  );
};

export default DatasetSelector;
