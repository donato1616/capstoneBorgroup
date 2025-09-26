const express = require('express');
const { PrismaClient } = require('@prisma/client'); // Import Prisma Client

const app = express();
const prisma = new PrismaClient();
const PORT = 5000;

// Middleware to parse JSON bodies
app.use(express.json());

// Endpoint to get analytics for a specific dataset with optional filtering
app.get('/api/analytics/:datasetId', async (req, res) => {
  const datasetId = parseInt(req.params.datasetId);

  // Filtering options from query parameters
  const { region, isComplete, startDate, endDate } = req.query;

  try {
    const dataset = await prisma.datasets.findUnique({
      where: { id: datasetId },
      include: {
        responses: {
          where: {
            AND: [
              region ? { region: region } : {},
              isComplete !== undefined ? { isComplete: isComplete === 'true' } : {},
              startDate ? { startDate: { gte: new Date(startDate) } } : {},
              endDate ? { startDate: { lte: new Date(endDate) } } : {},
            ],
          },
          include: {
            study: true,
            interviewer: true,
          },
        },
      },
    });

    if (!dataset) {
      return res.status(404).json({ message: 'Dataset not found' });
    }

    // Sort responses by startDate and startHour
    const sortedResponses = dataset.responses.sort((a, b) => {
      if (a.startDate < b.startDate) return -1;
      if (a.startDate > b.startDate) return 1;
      return a.startHour - b.startHour;
    });

    // Return dataset info and sorted responses
    res.json({
      dataset: {
        id: dataset.id,
        name: dataset.name,
        uploadDate: dataset.uploadDate,
        dataType: dataset.dataType,
      },
      responses: sortedResponses,
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ message: 'Error fetching analytics' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
