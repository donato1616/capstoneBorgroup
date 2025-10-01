// frontend/src/components/DatasetSelector.jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const DatasetSelector = ({ onSelectDataset }) => {
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState('');

  useEffect(() => {
    // Fetch all datasets from backend
    const fetchDatasets = async () => {
      try {
        const response = await axios.get('http://localhost:5000/api/datasets');
        console.log('Datasets fetched from backend:', response.data); // Debug log
        if (Array.isArray(response.data) && response.data.length > 0) {
          setDatasets(response.data);
        } else {
          console.warn('No datasets found.');
          setDatasets([]);
        }
      } catch (error) {
        console.error('Error fetching datasets:', error);
        setDatasets([]);
      }
    };

    fetchDatasets();
  }, []);

  const handleChange = (e) => {
    const datasetId = e.target.value;
    setSelectedDataset(datasetId);
    onSelectDataset(datasetId); // Pass selected dataset ID to parent
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
          <option key={dataset.id} value={dataset.id}>
            {dataset.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default DatasetSelector;
