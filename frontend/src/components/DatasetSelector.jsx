// frontend/src/components/DatasetSelector.jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const DatasetSelector = ({ onSelectDataset }) => {
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState('');

  useEffect(() => {
    // Fetch all datasets from backend
    axios.get('http://localhost:5000/api/datasets') // Change URL if backend is hosted elsewhere
      .then((response) => {
        setDatasets(response.data);
      })
      .catch((error) => console.error('Error fetching datasets:', error));
  }, []);

  const handleChange = (e) => {
    const datasetId = e.target.value;
    setSelectedDataset(datasetId);
    onSelectDataset(datasetId); // Pass selected dataset ID to parent
  };

  return (
    <div>
      <label htmlFor="dataset-select">Select Dataset: </label>
      <select
        id="dataset-select"
        value={selectedDataset}
        onChange={handleChange}
      >
        <option value="">-- Choose a dataset --</option>
        {datasets.map((dataset) => (
          <option key={dataset.id} value={dataset.id}>
            {dataset.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default DatasetSelector;
