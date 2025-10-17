// backend/routes/dataset.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');

// ETL helpers (CommonJS versions we prepared)
const { chooseMapping, readBestSheet } = require('../etl/loader');
const { consolidateRows } = require('../etl/transform');

const prisma = new PrismaClient();

// ✅ IMPORTANT: use memoryStorage so req.file.buffer is available
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

/* ---------------------------------------
 * Helper: accept numeric id OR UUID
 * ------------------------------------- */
async function resolveDatasetIdFlexible(idParam) {
  const idText = String(idParam || '').trim();
  if (/^\d+$/.test(idText)) return Number(idText);          // numeric internal id used by ResponseFact.datasetId
  if (idText.includes('-')) {                                // UUID → map to old numeric id
    const rows = await prisma.$queryRaw`
      select old_dataset_id
      from ops.dataset_map
      where dataset_id = ${idText}
      limit 1
    `;
    if (rows.length && Number.isFinite(rows[0].old_dataset_id)) return Number(rows[0].old_dataset_id);
    throw new Error('Unknown dataset UUID (cannot map to numeric id)');
  }
  throw new Error('Invalid dataset id format');
}

// ------------------------------------------------------------------
// GET /api/dataset
// Simple list for dropdowns (kept)
// ------------------------------------------------------------------
router.get('/', async (_req, res) => {
  try {
    const rows = await prisma.datasets.findMany({
      select: {
        id: true,
        name: true,
        upload_date: true,
        status: true,
        data_type: true,
        file_format: true,
        tags: true,
      },
      orderBy: { upload_date: 'desc' },
    });

    const out = rows.map((r) => ({
      dataset_id: r.id,
      name: r.name,
      upload_date: r.upload_date,
      status: r.status,
      data_type: r.data_type,
      file_format: r.file_format,
      tags: r.tags || '',
    }));

    res.json(out);
  } catch (err) {
    console.error('Error fetching dataset list:', err);
    res.status(500).json({ message: 'Error fetching dataset list', detail: err.message });
  }
});

// ------------------------------------------------------------------
// POST /api/dataset/upload   (CSV/XLSX)
// Registers dataset, consolidates to ResponseFact
// ------------------------------------------------------------------
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    // Basic guards
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (!req.file.buffer || !Buffer.isBuffer(req.file.buffer)) {
      // This happens if memoryStorage is not set
      return res.status(400).json({ error: 'File buffer missing (multer memoryStorage not active)' });
    }

    const fname = req.file.originalname || 'upload';
    const lower = fname.toLowerCase();
    const isCsv = lower.endsWith('.csv');
    const isXlsx = lower.endsWith('.xlsx') || lower.endsWith('.xls');
    if (!isCsv && !isXlsx) {
      return res.status(400).json({ error: 'Only .csv or .xlsx/.xls allowed' });
    }

    // 1) Register dataset (adjust field names if your Prisma model differs)
    const ds = await prisma.datasets.create({
      data: {
        name: req.body?.name || fname,
        upload_date: new Date(),
        status: 'Processed',
        data_type: req.body?.data_type || 'survey responses',
        file_format: isCsv ? 'CSV' : 'Excel',
        tags: req.body?.tags || '',
      },
    });

    // 2) Read sheet + normalize
    let rows, sheetName, normMap;
    try {
      const mapping = chooseMapping(fname);
      const r = readBestSheet(req.file.buffer, fname, mapping);
      rows = r.rows;
      sheetName = r.sheetName;
      normMap = r.normMap;
    } catch (parseErr) {
      console.error('❌ ETL parse error:', parseErr);
      return res.status(400).json({ error: 'Failed to parse file', detail: String(parseErr.message || parseErr) });
    }

    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'No data rows detected' });
    }

    // 3) Consolidate to facts (long form)
    let facts, issues;
    try {
      const out = consolidateRows(rows, {}, normMap);
      facts = out.facts;
      issues = out.issues || [];
    } catch (tfErr) {
      console.error('❌ ETL transform error:', tfErr);
      return res.status(500).json({ error: 'Transform failed', detail: String(tfErr.message || tfErr) });
    }

    // 4) Bulk insert to ResponseFact
    try {
      if (facts.length > 0) {
        const chunkSize = 1000;
        for (let i = 0; i < facts.length; i += chunkSize) {
          const chunk = facts.slice(i, i + chunkSize);
          await prisma.responseFact.createMany({
            data: chunk.map((f) => ({
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
              cleanJson: f.cleanJson,
            })),
            skipDuplicates: true,
          });
        }
      }
    } catch (dbErr) {
      console.error('❌ DB insert error (ResponseFact.createMany):', dbErr);
      // Rollback dataset header if you want, or keep it and show 0 facts
      return res.status(500).json({
        error: 'Database insert failed',
        detail: String(dbErr.message || dbErr),
      });
    }

    return res.json({
      status: 'ok',
      dataset_id: ds.id,
      sheet: sheetName,
      inserted_facts: facts.length,
      issues_count: issues.length,
      file_info: {
        name: fname,
        size_bytes: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error('❌ Upload/ETL failed:', err);
    return res.status(500).json({ error: 'Upload/ETL failed', detail: String(err.message || err) });
  }
});

// ------------------------------------------------------------------
// Quick parser smoke test without DB writes
// POST /api/dataset/upload-check
// ------------------------------------------------------------------
console.log('[dataset.js] routes loaded at', new Date().toISOString());
router.post('/upload-check', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file/No buffer' });
    }
    const fname = req.file.originalname || 'upload';
    const mapping = chooseMapping(fname);
    const { rows, sheetName, normMap, headers } = readBestSheet(req.file.buffer, fname, mapping);
    const sample = rows.slice(0, 3);
    return res.json({
      ok: true,
      file: { name: fname, size: req.file.size, mimetype: req.file.mimetype },
      sheet: sheetName,
      headers,
      first_rows: sample,
    });
  } catch (e) {
    console.error('upload-check failed:', e);
    res.status(500).json({ error: 'upload_check_failed', detail: e.message });
  }
});

// ------------------------------------------------------------------
// (Keep your other routes: /:datasetId/responses, /:id/summary, /:id/qdist)
// ------------------------------------------------------------------
/* ---------------------------------------
 * GET /api/dataset/:id/summary
 * Accepts numeric id or UUID (uses resolveDatasetIdFlexible)
 * ------------------------------------- */
router.get('/:id/summary', async (req, res) => {
  try {
    const datasetId = await resolveDatasetIdFlexible(req.params.id);

    const factCount = await prisma.responseFact.count({ where: { datasetId } });

    const respondents = await prisma.responseFact.findMany({
      where: { datasetId },
      select: { respondentId: true },
      distinct: ['respondentId'],
      take: 1_000_000
    });
    const respondentCount = respondents.length;

    let byRegion = [];
    if (factCount > 0) {
      const regionAgg = await prisma.responseFact.groupBy({
        by: ['region'],
        where: { datasetId, NOT: { region: null } },
        _count: { _all: true },
        orderBy: { _count: { _all: 'desc' } },
        take: 15
      });
      byRegion = regionAgg.map(r => ({ region: r.region, c: r._count._all }));
    }

    let topQuestions = [];
    if (factCount > 0) {
      const qAgg = await prisma.responseFact.groupBy({
        by: ['questionCode'],
        where: { datasetId },
        _count: { _all: true },
        orderBy: { _count: { _all: 'desc' } },
        take: 20
      });
      topQuestions = qAgg.map(q => ({ question: q.questionCode, c: q._count._all }));
    }

    res.json({
      dataset_id: datasetId,
      respondent_count: respondentCount,
      fact_count: factCount,
      by_region: byRegion,
      top_questions: topQuestions
    });
  } catch (err) {
    console.error('Error building summary:', err);
    res.status(404).json({ message: 'summary_failed', detail: err.message });
  }
});

/* ---------------------------------------
 * GET /api/dataset/:id/qdist?questionCode=...
 * ------------------------------------- */
router.get('/:id/qdist', async (req, res) => {
  try {
    const datasetId = await resolveDatasetIdFlexible(req.params.id);
    const q = String(req.query.questionCode || '').trim();
    if (!q) return res.status(400).json({ error: 'questionCode required' });

    const rows = await prisma.responseFact.findMany({
      where: { datasetId, questionCode: q },
      select: { answerText: true, answerNum: true }
    });

    const nums = rows
      .map(r => (r.answerNum === null || r.answerNum === undefined ? null : Number(r.answerNum)))
      .filter(v => v !== null && Number.isFinite(v));

    const bins = [];
    if (nums.length) {
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const k = 10;
      const step = (max - min) / (k || 1) || 1;
      for (let i = 0; i < k; i++) {
        const lo = min + i * step;
        const hi = i === k - 1 ? max : lo + step;
        const cnt = nums.filter(v => v >= lo && v <= hi).length;
        bins.push({ lo, hi, count: cnt });
      }
    }

    const tf = {};
    for (const r of rows) if (r.answerText) tf[r.answerText] = (tf[r.answerText] || 0) + 1;
    const text_top = Object.entries(tf).sort((a, b) => b[1] - a[1]).slice(0, 30)
      .map(([label, count]) => ({ label, count }));

    res.json({ numeric_bins: bins, text_top });
  } catch (err) {
    console.error('Error building qdist:', err);
    res.status(404).json({ message: 'qdist_failed', detail: err.message });
  }
});

/* ---------------------------------------
 * GET /api/dataset/:id/diagnostics
 * ------------------------------------- */
router.get('/:id/diagnostics', async (req, res) => {
  try {
    const datasetId = await resolveDatasetIdFlexible(req.params.id);
    const factCount = await prisma.responseFact.count({ where: { datasetId } });

    const byQuestion = await prisma.responseFact.groupBy({
      by: ['questionCode'],
      where: { datasetId },
      _count: { _all: true },
      orderBy: { _count: { _all: 'desc' } },
      take: 20
    });

    const byRegion = await prisma.responseFact.groupBy({
      by: ['region'],
      where: { datasetId, NOT: { region: null } },
      _count: { _all: true },
      orderBy: { _count: { _all: 'desc' } },
      take: 10
    });

    const sample = await prisma.responseFact.findMany({
      where: { datasetId },
      select: { respondentId: true, questionCode: true, region: true, answerText: true, answerNum: true },
      take: 5
    });

    res.json({
      dataset_id: datasetId,
      fact_count: factCount,
      by_question: byQuestion.map(q => ({ question: q.questionCode, count: q._count._all })),
      by_region: byRegion.map(r => ({ region: r.region, count: r._count._all })),
      sample
    });
  } catch (e) {
    res.status(500).json({ message: 'diagnostics_failed', detail: e.message });
  }
});


module.exports = router;
