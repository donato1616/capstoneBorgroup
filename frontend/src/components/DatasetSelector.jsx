// frontend/src/components/DatasetSelector.jsx
import React, { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

const DatasetSelector = ({ onSelectDataset }) => {
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState('');

  useEffect(() => {
    const fetchDatasets = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/datasets`, {
          credentials: 'include',  // Ensures cookies are included in the request
        });

        if (!response.ok) throw new Error('Error fetching datasets');
        const data = await response.json();

        if (Array.isArray(data) && data.length > 0) {
          setDatasets(data);
          setSelectedDataset(data[0].dataset_id); // Auto-select the first dataset
          onSelectDataset(data[0].dataset_id);     // Pass it to parent
        } else {
          console.warn('No datasets found');
          setDatasets([]);
        }
      } catch (error) {
        console.error('Error fetching datasets:', error);
        setDatasets([]);
      }
    };

    fetchDatasets();
  }, []); // runs only once on component mount

  const handleChange = (e) => {
    const datasetId = e.target.value;
    setSelectedDataset(datasetId);
    onSelectDataset(datasetId);
  };

  return (
    <div>
      <label htmlFor="dataset-select" className="mr-2 font-medium">
        Select Dataset:
      </label>
      <select
        id="dataset-select"
        value={selectedDataset}
        onChange={handleChange}
        className="border rounded px-2 py-1"
      >
        <option value="">-- Choose a dataset --</option>
        {datasets.map((dataset) => (
          <option key={dataset.dataset_id} value={dataset.dataset_id}>
            {dataset.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default DatasetSelector;
