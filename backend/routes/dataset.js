// backend/routes/dataset.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');

const { chooseMapping, readBestSheet } = require('../etl/loader');
const { consolidateRows } = require('../etl/transform');

const prisma = new PrismaClient();

// Multer in-memory so req.file.buffer is available
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ----------------------------
// Helpers
// ----------------------------
function parseId(reqParam) {
  const n = Number(String(reqParam || '').trim());
  if (!Number.isFinite(n)) throw new Error('Invalid dataset id');
  return n;
}

// ----------------------------
// GET /api/dataset  (list for dropdown, defensive)
// ----------------------------
router.get('/', async (_req, res) => {
  try {
    // Raw SQL avoids Prisma field-mapping mistakes
    const rows = await prisma.$queryRawUnsafe(`
      select
        id,
        name,
        upload_date,
        status,
        data_type,
        file_format,
        coalesce(tags,'') as tags
      from datasets
      order by upload_date desc nulls last, id desc
    `);

    // Normalize to the shape the frontend expects
    const out = (rows || []).map(r => ({
      dataset_id: r.id,
      name: r.name,
      upload_date: r.upload_date,
      status: r.status,
      data_type: r.data_type,
      file_format: r.file_format,
      tags: r.tags || ''
    }));

    res.json(out);
  } catch (e) {
    console.error('dataset_list_failed:', e);
    res.status(500).json({
      message: 'dataset_list_failed',
      detail: e?.message || String(e)
    });
  }
});

// Optional: tiny debug to confirm DB connectivity & row count
router.get('/_health', async (_req, res) => {
  try {
    const c = await prisma.$queryRawUnsafe(`select count(*)::int as c from datasets`);
    res.json({ ok: true, datasets: c?.[0]?.c ?? 0 });
  } catch (e) {
    res.status(500).json({ ok: false, detail: e.message });
  }
});


// ----------------------------
// POST /api/dataset/upload
// ----------------------------
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded / no buffer' });
    }
    const fname = req.file.originalname || 'upload';
    const lower = fname.toLowerCase();
    const isCsv = lower.endsWith('.csv');
    const isXlsx = lower.endsWith('.xlsx') || lower.endsWith('.xls');
    if (!isCsv && !isXlsx) {
      return res.status(400).json({ error: 'Only .csv or .xlsx/.xls allowed' });
    }

    // 1) header row
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

    // 2) parse
    let rows, sheetName, normMap;
    const mapping = chooseMapping(fname);
    try {
      const r = readBestSheet(req.file.buffer, fname, mapping);
      rows = r.rows; sheetName = r.sheetName; normMap = r.normMap;
    } catch (e) {
      return res.status(400).json({ error: 'Failed to parse file', detail: e.message });
    }
    if (!rows?.length) return res.status(400).json({ error: 'No data rows detected' });

    // 3) transform → facts
    let facts = [], issues = [];
    try {
      const out = consolidateRows(rows, {}, normMap);
      facts = out.facts || []; issues = out.issues || [];
    } catch (e) {
      return res.status(500).json({ error: 'Transform failed', detail: e.message });
    }

    // 4) bulk insert
    try {
      const CHUNK = 1000;
      for (let i = 0; i < facts.length; i += CHUNK) {
        const chunk = facts.slice(i, i + CHUNK);
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
            cleanJson: f.cleanJson,
          })),
          skipDuplicates: true,
        });
      }
    } catch (e) {
      console.error('createMany failed', e);
      return res.status(500).json({ error: 'Database insert failed', detail: e.message });
    }

    res.json({
      status: 'ok',
      dataset_id: ds.id,
      sheet: sheetName,
      inserted_facts: facts.length,
      issues_count: issues.length,
      file_info: { name: fname, size_bytes: req.file.size, mimetype: req.file.mimetype },
    });
  } catch (e) {
    console.error('upload failed', e);
    res.status(500).json({ error: 'Upload/ETL failed', detail: e.message });
  }
});

// ----------------------------
// GET /api/dataset/:id/summary
// ----------------------------
router.get('/:id/summary', async (req, res) => {
  try {
    const id = parseId(req.params.id);

    const factCount = await prisma.responseFact.count({ where: { datasetId: id } });

    const respondents = await prisma.responseFact.findMany({
      where: { datasetId: id },
      select: { respondentId: true },
      distinct: ['respondentId'],
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
      by_region: byRegion || [],
      top_questions: topQuestions || [],
    });
  } catch (e) {
    res.status(400).json({ message: 'summary_failed', detail: e.message });
  }
});

// ----------------------------
// GET /api/dataset/:id/qdist?questionCode=Q17
// ----------------------------
router.get('/:id/qdist', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const q = String(req.query.questionCode || '').trim();
    if (!q) return res.status(400).json({ error: 'questionCode required' });

    const rows = await prisma.responseFact.findMany({
      where: { datasetId: id, questionCode: q },
      select: { answerText: true, answerNum: true },
      take: 50000,
    });

    const nums = rows.map(r => r.answerNum).filter(v => v !== null && v !== undefined).map(Number);
    const texts = rows.map(r => r.answerText).filter(Boolean);

    const bins = [];
    if (nums.length) {
      const min = Math.min(...nums), max = Math.max(...nums);
      const k = 10, step = ((max - min) / (k || 1)) || 1;
      for (let i = 0; i < k; i++) {
        const lo = min + i * step;
        const hi = i === k - 1 ? max : lo + step;
        const cnt = nums.filter(v => v >= lo && v <= hi).length;
        bins.push({ lo, hi, count: cnt });
      }
    }
    const tf = {};
    texts.forEach(t => tf[t] = (tf[t] || 0) + 1);
    const text_top = Object.entries(tf).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([label,count])=>({label, count}));

    res.json({ numeric_bins: bins, text_top });
  } catch (e) {
    res.status(400).json({ message: 'qdist_failed', detail: e.message });
  }
});

// ----------------------------
// GET /api/dataset/:id/series   (daily submissions)
// ----------------------------
router.get('/:id/series', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const series = await prisma.$queryRawUnsafe(`
      select
        date_trunc('day', "interviewDate")::date as day,
        count(distinct "respondentId")::int as respondents,
        count(*)::int as facts
      from "ResponseFact"
      where "datasetId" = $1 and "interviewDate" is not null
      group by 1
      order by 1
    `, id);
    res.json({ daily: series || [] });
  } catch (e) {
    res.status(400).json({ message: 'series_failed', detail: e.message });
  }
});

module.exports = router;
