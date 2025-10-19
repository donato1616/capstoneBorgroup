// backend/routes/dataset.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');

const { chooseMapping, readBestSheet } = require('../etl/loader');
const { consolidateRows } = require('../etl/transform');

const prisma = new PrismaClient();

// Multer memory storage (so req.file.buffer exists)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ----------------------------
// Helpers
// ----------------------------
function numId(v) {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

// ----------------------------
// GET /api/dataset  (list for dropdowns)
// ----------------------------
router.get('/', async (_req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT id, name, upload_date, status, data_type, file_format, COALESCE(tags,'') AS tags
      FROM datasets
      ORDER BY upload_date DESC NULLS LAST, id DESC
    `);
    const out = (rows||[]).map(r => ({
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
    res.status(500).json({ message: 'dataset_list_failed', detail: e.message });
  }
});

// tiny health
router.get('/_health', async (_req, res) => {
  try {
    const c = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM datasets`);
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
    if (!req.file?.buffer) return res.status(400).json({ error: 'No file uploaded / no buffer' });

    const fname = req.file.originalname || 'upload';
    const lower = fname.toLowerCase();
    const isCsv = lower.endsWith('.csv');
    const isXlsx = lower.endsWith('.xlsx') || lower.endsWith('.xls');
    if (!isCsv && !isXlsx) return res.status(400).json({ error: 'Only .csv or .xlsx/.xls allowed' });

    // 1) header
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
    try {
      const mapping = chooseMapping(fname);
      const r = readBestSheet(req.file.buffer, fname, mapping);
      rows = r.rows; sheetName = r.sheetName; normMap = r.normMap;
    } catch (e) {
      console.error('parse_failed:', e);
      return res.status(400).json({ error: 'Failed to parse file', detail: e.message });
    }
    if (!rows?.length) return res.status(400).json({ error: 'No data rows detected' });

    // 3) transform
    let facts = [], issues = [];
    try {
      const out = consolidateRows(rows, {}, normMap);
      facts = out.facts || []; issues = out.issues || [];
    } catch (e) {
      console.error('transform_failed:', e);
      return res.status(500).json({ error: 'Transform failed', detail: e.message });
    }

    // 4) bulk insert to "ResponseFact"
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
      console.error('createMany_failed:', e);
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
    console.error('upload_failed:', e);
    res.status(500).json({ error: 'Upload/ETL failed', detail: e.message });
  }
});

// ----------------------------
// GET /api/dataset/:id/summary   (never 404 on a valid id; returns zeros)
// ----------------------------
router.get('/:id/summary', async (req, res) => {
  const id = numId(req.params.id);
  if (id == null) return res.status(400).json({ message: 'invalid_id' });

  try {
    const [{ fc }] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS fc FROM "ResponseFact" WHERE "datasetId" = $1
    `, id);

    const [{ rc }] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(DISTINCT "respondentId")::int AS rc FROM "ResponseFact" WHERE "datasetId" = $1
    `, id);

    const byRegion = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(NULLIF(TRIM(region),''),'Unspecified') AS region,
             COUNT(*)::int AS c
      FROM "ResponseFact"
      WHERE "datasetId" = $1
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
      LIMIT 30
    `, id);

    res.json({
      dataset_id: id,
      respondent_count: rc ?? 0,
      fact_count: fc ?? 0,
      by_region: byRegion || [],
      top_questions: topQuestions || [],
    });
  } catch (e) {
    console.error('summary_failed:', e);
    // Return an empty but valid structure so the UI doesn't error
    res.json({
      dataset_id: id, respondent_count: 0, fact_count: 0, by_region: [], top_questions: []
    });
  }
});

// ----------------------------
// GET /api/dataset/:id/qdist?questionCode=Qxx
// ----------------------------
router.get('/:id/qdist', async (req, res) => {
  const id = numId(req.params.id);
  if (id == null) return res.status(400).json({ error: 'invalid_id' });
  const q = String(req.query.questionCode || '').trim();
  if (!q) return res.status(400).json({ error: 'questionCode required' });

  try {
    const rows = await prisma.responseFact.findMany({
      where: { datasetId: id, questionCode: q },
      select: { answerText: true, answerNum: true },
      take: 100000,
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
        const cnt = nums.filter(v => (i===k-1 ? (v >= lo && v <= hi) : (v >= lo && v < hi))).length;
        bins.push({ lo, hi, count: cnt });
      }
    }
    const tf = {};
    texts.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
    const text_top = Object.entries(tf).sort((a,b)=>b[1]-a[1]).slice(0,30)
                        .map(([label,count])=>({label, count}));

    res.json({ numeric_bins: bins, text_top });
  } catch (e) {
    console.error('qdist_failed:', e);
    res.json({ numeric_bins: [], text_top: [] });
  }
});

// ----------------------------
// GET /api/dataset/:id/series   (daily submissions)
// ----------------------------
router.get('/:id/series', async (req, res) => {
  const id = numId(req.params.id);
  if (id == null) return res.status(400).json({ message: 'invalid_id' });

  try {
    const series = await prisma.$queryRawUnsafe(`
      SELECT DATE("interviewDate") AS day,
             COUNT(DISTINCT "respondentId")::int AS respondents,
             COUNT(*)::int AS facts
      FROM "ResponseFact"
      WHERE "datasetId" = $1 AND "interviewDate" IS NOT NULL
      GROUP BY day
      ORDER BY day
    `, id);
    res.json({ daily: series || [] });
  } catch (e) {
    console.error('series_failed:', e);
    res.json({ daily: [] });
  }
});

// ----------------------------
// COMPLETION (distinct respondents)
// ----------------------------
router.get('/:id/completion/daily', async (req, res) => {
  const id = numId(req.params.id);
  if (id == null) return res.status(400).json({ error: 'invalid_id' });

  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT DATE("interviewDate") AS d,
             COUNT(DISTINCT "respondentId")::int AS cnt
      FROM "ResponseFact"
      WHERE "datasetId" = $1 AND "interviewDate" IS NOT NULL
      GROUP BY d
      ORDER BY d
    `, id);
    res.json({ items: rows || [] });
  } catch (e) {
    console.error('completion_daily_failed:', e);
    res.json({ items: [] });
  }
});

router.get('/:id/completion/by-region', async (req, res) => {
  const id = numId(req.params.id);
  if (id == null) return res.status(400).json({ error: 'invalid_id' });

  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(NULLIF(TRIM(region),''),'Unspecified') AS region,
             COUNT(DISTINCT "respondentId")::int AS cnt
      FROM "ResponseFact"
      WHERE "datasetId" = $1
      GROUP BY region
      ORDER BY cnt DESC
      LIMIT 20
    `, id);
    res.json({ items: rows || [] });
  } catch (e) {
    console.error('completion_by_region_failed:', e);
    res.json({ items: [] });
  }
});

router.get('/:id/completion/by-interviewer', async (req, res) => {
  const id = numId(req.params.id);
  if (id == null) return res.status(400).json({ error: 'invalid_id' });

  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(NULLIF(TRIM(interviewer),''),'Unspecified') AS interviewer,
             COUNT(DISTINCT "respondentId")::int AS cnt
      FROM "ResponseFact"
      WHERE "datasetId" = $1
      GROUP BY interviewer
      ORDER BY cnt DESC
      LIMIT 20
    `, id);
    res.json({ items: rows || [] });
  } catch (e) {
    console.error('completion_by_interviewer_failed:', e);
    res.json({ items: [] });
  }
});

// ----------------------------
// PREDICTIVE (baseline regression + horizon)
// ----------------------------
function linearFit(points) {
  const n = points.length;
  if (n < 2) return { a: 0, b: points[0]?.y || 0, r2: 0, mse: 0, mape: null, yhat: points.map(p=>p.y) };
  const sum = (f) => points.reduce((s,p)=>s + f(p), 0);
  const sx = sum(p=>p.x), sy = sum(p=>p.y);
  const sxx = sum(p=>p.x*p.x), sxy = sum(p=>p.x*p.y);
  const denom = (n * sxx - sx*sx) || 1;
  const a = (n * sxy - sx*sy) / denom;
  const b = (sy - a*sx) / n;
  const yhat = points.map(p => a*p.x + b);
  const ybar = sy / n;
  const ssRes = points.reduce((s,p,i)=>s + Math.pow(p.y - yhat[i], 2), 0);
  const ssTot = points.reduce((s,p)=>s + Math.pow(p.y - ybar, 2), 0) || 1;
  const mse  = ssRes / n;
  const r2   = 1 - (ssRes / ssTot);
  const ape = points.filter((p,i)=>p.y !== 0).map((p,i)=>Math.abs((p.y - yhat[i]) / p.y));
  const mape = ape.length ? (ape.reduce((s,v)=>s+v,0) / ape.length) : null;
  return { a, b, r2, mse, mape, yhat };
}

router.get('/:id/forecast', async (req, res) => {
  const id = numId(req.params.id);
  if (id == null) return res.status(400).json({ message: 'invalid_id' });

  try {
    const daily = await prisma.$queryRawUnsafe(`
      SELECT DATE("interviewDate") AS day,
             COUNT(DISTINCT "respondentId")::int AS cnt
      FROM "ResponseFact"
      WHERE "datasetId" = $1 AND "interviewDate" IS NOT NULL
      GROUP BY day
      ORDER BY day
    `, id);

    const pts = (daily||[]).map((r, i) => ({ x: i, y: Number(r.cnt || 0) }));
    const fit = linearFit(pts);

    // 7-day projection (carry last day if no trend)
    const lastDate = daily?.[daily.length-1]?.day
      ? new Date(daily[daily.length-1].day) : new Date();
    const lastX = pts.length ? pts[pts.length - 1].x : 0;
    const horizon = Array.from({length:7}, (_,k) => {
      const d = new Date(lastDate); d.setDate(d.getDate() + (k+1));
      const x = lastX + k + 1;
      const y = pts.length ? (fit.a * x + fit.b) : 0;
      return { date: d.toISOString().slice(0,10), projected: Math.max(0, Math.round(y)) };
    });

    res.json({ dataset_id: id, metrics: { r2: fit.r2, mse: fit.mse, mape: fit.mape }, horizon });
  } catch (e) {
    console.error('forecast_failed:', e);
    res.json({ dataset_id: id, metrics: { r2: 0, mse: 0, mape: null }, horizon: [] });
  }
});

module.exports = router;
