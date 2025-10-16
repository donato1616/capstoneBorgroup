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
      upload_date: r.uploadDate,
      status: r.status,
      data_type: r.dataType,
      file_format: r.fileFormat,
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

// ... your existing responses/summary/qdist routes stay here ...

module.exports = router;
