const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// GET /api/studies/:studyCode/summary
router.get('/:studyCode/summary', async (req, res) => {
  const { studyCode } = req.params;

  try {
    // Find the study by code
    const study = await prisma.studies.findUnique({
      where: { code: studyCode },
      select: { id: true, code: true }
    });

    if (!study) {
      return res.status(404).json({ error: 'Study not found' });
    }

    // Count total responses and completed responses
    const totalResponses = await prisma.responses.count({
      where: { study_id: study.id }
    });

    const completedResponses = await prisma.responses.count({
      where: { study_id: study.id, is_complete: true }
    });

    // Average duration_sec (ignoring nulls)
    const avgDuration = await prisma.responses.aggregate({
      where: { study_id: study.id, duration_sec: { not: null } },
      _avg: { duration_sec: true }
    });

    // Min/max start_date for study timeline
    const dateRange = await prisma.responses.aggregate({
      where: { study_id: study.id, start_date: { not: null } },
      _min: { start_date: true },
      _max: { start_date: true }
    });

    res.json({
      studyCode,
      totals: {
        responses: totalResponses,
        completes: completedResponses
      },
      completionRate: totalResponses > 0 ? completedResponses / totalResponses : 0,
      avgDurationSec: avgDuration._avg.duration_sec || 0,
      dateRange: {
        min: dateRange._min.start_date ? dateRange._min.start_date.toISOString().slice(0, 10) : null,
        max: dateRange._max.start_date ? dateRange._max.start_date.toISOString().slice(0, 10) : null
      }
    });
  } catch (err) {
    console.error('Error fetching study summary:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;