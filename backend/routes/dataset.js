const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/dataset/:datasetId/responses
router.get('/:datasetId/responses', async (req, res) => {
  try {
    const datasetId = parseInt(req.params.datasetId);

    // Fetch dataset info along with all related responses
    const datasetWithResponses = await prisma.datasets.findUnique({
      where: { id: datasetId },
      include: {
        responses: {
          include: {
            study: true,
            interviewer: true,
          },
        },
      },
    });

    if (!datasetWithResponses) {
      return res.status(404).json({ message: 'Dataset not found' });
    }

    // Optional: sort responses by startDate and startHour
    const sortedResponses = datasetWithResponses.responses.sort((a, b) => {
      if (a.startDate < b.startDate) return -1;
      if (a.startDate > b.startDate) return 1;
      return a.startHour - b.startHour;
    });

    res.json({
      dataset: {
        id: datasetWithResponses.id,
        name: datasetWithResponses.name,
        uploadDate: datasetWithResponses.uploadDate,
        dataType: datasetWithResponses.dataType,
      },
      responses: sortedResponses,
    });
  } catch (err) {
    console.error('Error fetching dataset responses:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
