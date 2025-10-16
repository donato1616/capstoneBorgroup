// test-server.js
const express = require('express');
const app = express();

// Minimal CORS-friendly endpoint
app.get('/api/test', (req, res) => {
  console.log('Test endpoint hit', req.headers); // log requests
  res.setHeader('Access-Control-Allow-Origin', '*'); // allow all origins
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  // Send fake datasets
  res.json([
    { dataset_id: '1', name: 'Test Dataset 1' },
    { dataset_id: '2', name: 'Test Dataset 2' }
  ]);
});

const PORT = 5001;
app.listen(PORT, () => console.log(`Test server running on http://localhost:${PORT}`));
