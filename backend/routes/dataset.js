// backend/routes/dataset.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');

// ETL helpers (keep your file paths)
const { chooseMapping, readBestSheet } = require('../etl/loader');
const { consolidateRows } = require('../etl/transform');

const prisma = new PrismaClient();
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });

/* ------------------------------------------------------------------
 * GET /api/dataset
 * Simple list for dropdowns
 * ------------------------------------------------------------------ */
router.get('/', async (_req, res) => {
  try {
    const rows = await prisma.datasets.findMany({
      select: {
        id: true,
        name: true,
        uploadDate: true,   // if your Prisma model uses upload_date, change to upload_date
        status: true,
        dataType: true,     // change to data_type if that’s your Prisma field
        fileFormat: true,   // change to file_format if needed
        tags: true
      },
      orderBy: { uploadDate: 'desc' }
    });

    const out = rows.map(r => ({
      dataset_id: r.id,
      name: r.name,
      upload_date: r.uploadDate,
      status: r.status,
      data_type: r.dataType,
      file_format: r.fileFormat,
      tags: r.tags || ''
    }));

    res.json(out);
  } catch (err) {
    console.error('Error fetching dataset list:', err);
    res.status(500).json({ message: 'Error fetching dataset list', detail: err.message });
  }
});

/* ------------------------------------------------------------------
 * POST /api/dataset/upload  (CSV/XLSX)
 * Registers dataset, consolidates to ResponseFact
 * ------------------------------------------------------------------ */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const fname = req.file.originalname || 'upload';
    const lower = fname.toLowerCase();
    const isCsv = lower.endsWith('.csv');
    const isXlsx = lower.endsWith('.xlsx') || lower.endsWith('.xls');
    if (!isCsv && !isXlsx) {
      return res.status(400).json({ error: 'Only .csv or .xlsx/.xls allowed' });
    }

    // 1) Register dataset
    const ds = await prisma.datasets.create({
      data: {
        name: req.body?.name || fname,
        uploadDate: new Date(),                 // adjust to upload_date if needed
        status: 'Processed',
        dataType: req.body?.data_type || 'survey responses',
        fileFormat: isCsv ? 'CSV' : 'Excel',
        tags: req.body?.tags || ''
      }
    });

    // 2) Read sheet + normalize
    const mapping = chooseMapping(fname);
    const { rows, sheetName, normMap } = readBestSheet(req.file.buffer, fname, mapping);
    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'No data rows detected' });
    }

    // 3) Consolidate to facts
    const { facts, issues } = consolidateRows(rows, mapping, normMap);

    // 4) Bulk insert facts
    const chunkSize = 1000;
    for (let i = 0; i < facts.length; i += chunkSize) {
      const chunk = facts.slice(i, i + chunkSize);
      await prisma.responseFact.createMany({
        data: chunk.map(f => ({
          datasetId: ds.id,
          respondentId: f.respondentId,
          interviewDate: f.interviewDate ? new Date(f.interviewDate) : null,
          region: f.region,
          city: f.city,
          interviewer: f.interviewer,
          channel: f.channel,
          questionCode: f.questionCode,
          answerText: f.answerText,
          answerNum: f.answerNum,
          rawJson: f.rawJson,
          cleanJson: f.cleanJson
        })),
        skipDuplicates: true
      });
    }

    return res.json({
      status: 'ok',
      dataset_id: ds.id,
      sheet: sheetName,
      inserted_facts: facts.length,
      issues_count: issues.length
    });
  } catch (err) {
    console.error('Upload/ETL failed:', err);
    return res.status(500).json({ error: 'Upload/ETL failed', detail: err.message });
  }
});

/* ------------------------------------------------------------------
 * GET /api/dataset/:datasetId/responses
 * ------------------------------------------------------------------ */
router.get('/:datasetId/responses', async (req, res) => {
  try {
    const datasetId = parseInt(req.params.datasetId, 10);
    if (!Number.isFinite(datasetId)) return res.status(400).json({ message: 'Invalid dataset id' });

    const datasetWithResponses = await prisma.datasets.findUnique({
      where: { id: datasetId },
      include: {
        responses: {
          include: { study: true, interviewer: true }
        }
      }
    });

    if (!datasetWithResponses) {
      return res.status(404).json({ message: 'Dataset not found' });
    }

    const sortedResponses = [...(datasetWithResponses.responses || [])].sort((a, b) => {
      if (a.startDate < b.startDate) return -1;
      if (a.startDate > b.startDate) return 1;
      return (a.startHour || 0) - (b.startHour || 0);
    });

    res.json({
      dataset: {
        id: datasetWithResponses.id,
        name: datasetWithResponses.name,
        uploadDate: datasetWithResponses.uploadDate,
        dataType: datasetWithResponses.dataType
      },
      responses: sortedResponses
    });
  } catch (err) {
    console.error('Error fetching dataset responses:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/* ------------------------------------------------------------------
 * GET /api/dataset/:id/summary
 * KPIs: respondents, fact count, by region, top questions
 * ------------------------------------------------------------------ */
router.get('/:id/summary', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });

    const factCount = await prisma.responseFact.count({ where: { datasetId: id } });

    const respondents = await prisma.responseFact.findMany({
      where: { datasetId: id },
      select: { respondentId: true },
      distinct: ['respondentId']
    });

    const byRegion = await prisma.$queryRawUnsafe(`
      SELECT region, COUNT(*)::int AS c
      FROM "ResponseFact"
      WHERE "datasetId" = $1 AND region IS NOT NULL
      GROUP BY region
      ORDER BY c DESC
      LIMIT 15
    `, id);

    const topQuestions = await prisma.$queryRawUnsafe(`
      SELECT "questionCode" AS question, COUNT(*)::int AS c
      FROM "ResponseFact"
      WHERE "datasetId" = $1
      GROUP BY "questionCode"
      ORDER BY c DESC
      LIMIT 20
    `, id);

    res.json({
      dataset_id: id,
      respondent_count: respondents.length,
      fact_count: factCount,
      by_region: byRegion,
      top_questions: topQuestions
    });
  } catch (err) {
    console.error('Error building summary:', err);
    res.status(500).json({ message: 'Error building summary', detail: err.message });
  }
});

/* ------------------------------------------------------------------
 * GET /api/dataset/:id/qdist?questionCode=Q1
 * Numeric bins + top text answers
 * ------------------------------------------------------------------ */
router.get('/:id/qdist', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const q = String(req.query.questionCode || '').trim();
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    if (!q) return res.status(400).json({ error: 'questionCode required' });

    const rows = await prisma.responseFact.findMany({
      where: { datasetId: id, questionCode: q },
      select: { answerText: true, answerNum: true }
    });

    const numeric = rows
      .filter(r => r.answerNum !== null && r.answerNum !== undefined)
      .map(r => Number(r.answerNum));

    const text = rows.map(r => r.answerText).filter(Boolean);

    const bins = [];
    if (numeric.length) {
      const min = Math.min(...numeric);
      const max = Math.max(...numeric);
      const k = 10;
      const step = (max - min) / (k || 1) || 1;
      for (let i = 0; i < k; i++) {
        const lo = min + i * step;
        const hi = i === k - 1 ? max : lo + step;
        const cnt = numeric.filter(v => v >= lo && v <= hi).length;
        bins.push({ lo, hi, count: cnt });
      }
    }

    const textFreq = {};
    for (const t of text) textFreq[t] = (textFreq[t] || 0) + 1;
    const text_top = Object.entries(textFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([label, count]) => ({ label, count }));

    res.json({ numeric_bins: bins, text_top });
  } catch (err) {
    console.error('Error building qdist:', err);
    res.status(500).json({ message: 'Error building qdist', detail: err.message });
  }
});

module.exports = router;
