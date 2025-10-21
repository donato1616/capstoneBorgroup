// backend/routes/dataset.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const pythonScriptPath = './etl/etl_ingest.py';  // Path to your Python script (adjusted for correct folder)
const { PrismaClient } = require('@prisma/client');

const { chooseMapping, readBestSheet } = require('../etl/loader');
const { consolidateRows } = require('../etl/transform');
const { spawn } = require('child_process');

const prisma = new PrismaClient();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ---------------------------- helpers ----------------------------
function parseId(reqParam) {
  const n = Number(String(reqParam || '').trim());
  if (!Number.isFinite(n)) throw new Error('Invalid dataset id');
  return n;
}

// ---------------------------- list ----------------------------
router.get('/', async (_req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe(`
      select id, name, upload_date, status, data_type, file_format, coalesce(tags,'') as tags
      from datasets
      order by upload_date desc nulls last, id desc
    `);
    res.json((rows || []).map(r => ({
      dataset_id: r.id,
      name: r.name,
      upload_date: r.upload_date,
      status: r.status,
      data_type: r.data_type,
      file_format: r.file_format,
      tags: r.tags
    })));
  } catch (e) {
    console.error('dataset_list_failed:', e);
    res.status(500).json({ message: 'dataset_list_failed', detail: e.message });
  }
});

router.get('/_health', async (_req, res) => {
  try {
    const c = await prisma.$queryRawUnsafe(`select count(*)::int as c from datasets`);
    res.json({ ok: true, datasets: c?.[0]?.c ?? 0 });
  } catch (e) {
    res.status(500).json({ ok: false, detail: e.message });
  }
});

// ---------------------------- upload ----------------------------
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'No file uploaded' });

    const fname = req.file.originalname || 'upload.xlsx';
    const lower = fname.toLowerCase();
    const isCsv = lower.endsWith('.csv');
    const isXlsx = lower.endsWith('.xlsx') || lower.endsWith('.xls');
    if (!isCsv && !isXlsx) return res.status(400).json({ error: 'Only .csv or .xlsx/.xls allowed' });

    const ds = await prisma.datasets.create({
      data: {
        name: req.body?.name || fname,
        upload_date: new Date(),
        status: 'Processed',
        data_type: req.body?.data_type || 'survey responses',
        file_format: isCsv ? 'CSV' : 'Excel',
        tags: req.body?.tags || ''
      }
    });

    // parse
    let rows, sheetName, normMap;
    try {
      const r = readBestSheet(req.file.buffer, fname, chooseMapping(fname));
      rows = r.rows; sheetName = r.sheetName; normMap = r.normMap;
    } catch (e) {
      return res.status(400).json({ error: 'Failed to parse file', detail: e.message });
    }
    if (!rows?.length) return res.status(400).json({ error: 'No data rows detected' });

    // transform -> facts
    let facts = [], issues = [];
    try {
      const out = consolidateRows(rows, {}, normMap);
      facts = out.facts || []; issues = out.issues || [];
    } catch (e) {
      return res.status(500).json({ error: 'Transform failed', detail: e.message });
    }

    // bulk insert
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
            cleanJson: f.cleanJson
          })),
          skipDuplicates: true
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
      file_info: { name: fname, size_bytes: req.file.size, mimetype: req.file.mimetype }
    });
  } catch (e) {
    console.error('upload failed', e);
    res.status(500).json({ error: 'Upload/ETL failed', detail: e.message });
  }
});

// ---------------------------- delete (and delete-fallback) ----------------------------
// Standard REST delete
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    await prisma.responseFact.deleteMany({ where: { datasetId: id } });
    try { await prisma.$executeRawUnsafe(`delete from "AuditLog" where "datasetId" = $1`, id); } catch {}
    await prisma.datasets.delete({ where: { id } });
    res.json({ ok: true, deleted_dataset_id: id });
  } catch (e) {
    console.error('delete_failed', e);
    res.status(500).json({ ok: false, message: 'delete_failed', detail: e.message });
  }
});

// Some proxies don’t allow DELETE; provide a safe POST alias
router.post('/:id/delete', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    await prisma.responseFact.deleteMany({ where: { datasetId: id } });
    try { await prisma.$executeRawUnsafe(`delete from "AuditLog" where "datasetId" = $1`, id); } catch {}
    await prisma.datasets.delete({ where: { id } });
    res.json({ ok: true, deleted_dataset_id: id });
  } catch (e) {
    console.error('delete_post_failed', e);
    res.status(500).json({ ok: false, message: 'delete_post_failed', detail: e.message });
  }
});

// ---------------------------- summary / descriptive ----------------------------
router.get('/:id/summary', async (req, res) => {
  try {
    const id = parseId(req.params.id);

    const counts = await prisma.$queryRaw`
      SELECT
        COUNT(DISTINCT "respondentId")::int AS respondents_all,
        COUNT(*)::int                           AS facts_all,
        COUNT(DISTINCT CASE WHEN "interviewDate" IS NOT NULL THEN "respondentId" END)::int AS respondents_completed
      FROM "ResponseFact"
      WHERE "datasetId" = ${id}
    `;

    const byRegionFacts = await prisma.$queryRaw`
      SELECT COALESCE(region,'Unspecified') AS region, COUNT(*)::int AS facts
      FROM "ResponseFact"
      WHERE "datasetId" = ${id}
      GROUP BY region
      ORDER BY facts DESC
      LIMIT 10
    `;

    res.json({
      dataset_id: id,
      respondent_count: counts?.[0]?.respondents_all ?? 0,
      fact_count: counts?.[0]?.facts_all ?? 0,
      completed_respondents: counts?.[0]?.respondents_completed ?? 0,
      completed_pct: (() => {
        const a = counts?.[0]?.respondents_all || 0;
        const c = counts?.[0]?.respondents_completed || 0;
        return a ? (100 * c / a) : 0;
      })(),
      by_region_facts: byRegionFacts || []
    });
  } catch (e) {
    res.status(400).json({ message: 'summary_failed', detail: e.message });
  }
});

// Completed by region (bar)
router.get('/:id/by-region-completed', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.$queryRaw`
      SELECT COALESCE(region,'Unspecified') AS region,
             COUNT(DISTINCT "respondentId")::int AS completed
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY region
      ORDER BY completed DESC
      LIMIT 12
    `;
    res.json({ items: rows || [] });
  } catch (e) {
    res.status(400).json({ message: 'region_completed_failed', detail: e.message });
  }
});

// Daily series (dated)
router.get('/:id/series', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const series = await prisma.$queryRaw`
      SELECT DATE("interviewDate") AS day,
             COUNT(DISTINCT "respondentId")::int AS completed
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY day
      ORDER BY day
    `;
    res.json({ daily: series || [] });
  } catch (e) {
    res.status(400).json({ message: 'series_failed', detail: e.message });
  }
});

// ---------------------------- completion ----------------------------
router.get('/:id/completion/daily', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.$queryRaw`
      SELECT DATE("interviewDate") AS d, COUNT(DISTINCT "respondentId")::int AS cnt
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY d ORDER BY d
    `;
    res.json({ items: rows || [] });
  } catch (e) {
    console.error('completion_daily_failed:', e);
    res.status(500).json({ error: 'completion_daily_failed', detail: e.message });
  }
});

router.get('/:id/completion/by-region', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.$queryRaw`
      SELECT COALESCE(region,'Unspecified') AS region,
             COUNT(DISTINCT "respondentId")::int AS cnt
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY region
      ORDER BY cnt DESC
      LIMIT 20
    `;
    res.json({ items: rows || [] });
  } catch (e) {
    console.error('completion_by_region_failed:', e);
    res.status(500).json({ error: 'completion_by_region_failed', detail: e.message });
  }
});

router.get('/:id/completion/by-interviewer', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.$queryRaw`
      SELECT COALESCE(interviewer,'Unspecified') AS interviewer,
             COUNT(DISTINCT "respondentId")::int AS cnt
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY interviewer
      ORDER BY cnt DESC
      LIMIT 20
    `;
    res.json({ items: rows || [] });
  } catch (e) {
    console.error('completion_by_interviewer_failed:', e);
    res.status(500).json({ error: 'completion_by_interviewer_failed', detail: e.message });
  }
});

// ---------------------------- predictive (regression + synthetic fallback) ----------------------------
function linearFit(points) {
  const n = points.length;
  if (n < 2) return { a: 0, b: points[0]?.y || 0, r2: 0, mse: 0, mape: null, yhat: points.map(p => p.y) };
  const sum = f => points.reduce((s, p) => s + f(p), 0);
  const sx = sum(p => p.x), sy = sum(p => p.y);
  const sxx = sum(p => p.x * p.x), sxy = sum(p => p.x * p.y);
  const denom = (n * sxx - sx * sx) || 1;
  const a = (n * sxy - sx * sy) / denom;
  const b = (sy - a * sx) / n;
  const yhat = points.map(p => a * p.x + b);
  const ybar = sy / n;
  const ssRes = points.reduce((s, p, i) => s + Math.pow(p.y - yhat[i], 2), 0);
  const ssTot = points.reduce((s, p) => s + Math.pow(p.y - ybar, 2), 0) || 1;
  const mse = ssRes / n;
  const r2 = 1 - (ssRes / ssTot);
  const ape = points.filter((p, i) => p.y !== 0).map((p, i) => Math.abs((p.y - yhat[i]) / p.y));
  const mape = ape.length ? (ape.reduce((s, v) => s + v, 0) / ape.length) : null;
  return { a, b, r2, mse, mape, yhat };
}

function buildSyntheticHistory(total, days = 5) {
  // create a simple ramp-up then down distribution over the last N days
  // centered-ish so it looks plausible for demo purposes
  const today = new Date();
  const weights = Array.from({ length: days }, (_, i) => i + 1);
  const sumW = weights.reduce((s, w) => s + w, 0);
  const daily = weights.map(w => Math.round((w / sumW) * total));
  // fix rounding to match total
  let diff = total - daily.reduce((s, v) => s + v, 0);
  let idx = days - 1;
  while (diff > 0) { daily[idx]++; idx = (idx - 1 + days) % days; diff--; }

  const history = [];
  for (let i = days; i >= 1; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    history.push({ date: d.toISOString().slice(0, 10), value: daily[days - i] });
  }
  return history;
}

router.get('/:id/predict/regression', async (req, res) => {
  try {
    const id = parseId(req.params.id);

    // 1) try real dated history
    const daily = await prisma.$queryRaw`
      SELECT DATE("interviewDate") AS day,
             COUNT(DISTINCT "respondentId")::int AS completed
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY day
      ORDER BY day
    `;
    let pts = (daily || []).map((r, i) => ({ x: i, y: Number(r.completed || 0), date: r.day }));

    // 2) if not enough dated history, synthesize a small recent history based on total respondents
    let synthetic = false;
    if (pts.length < 2) {
      const totalDistinct = await prisma.$queryRaw`
        SELECT COUNT(DISTINCT "respondentId")::int AS n
        FROM "ResponseFact" WHERE "datasetId" = ${id}
      `;
      const total = totalDistinct?.[0]?.n || 0;
      const hist = buildSyntheticHistory(total, Math.min(7, Math.max(3, Math.ceil(Math.sqrt(Math.max(2, total))))));
      pts = hist.map((h, i) => ({ x: i, y: h.value, date: h.date }));
      synthetic = true;
    }

    const fit = linearFit(pts);

    // horizon (7-day)
    const horizon = [];
    if (pts.length) {
      const lastDate = new Date(pts[pts.length - 1].date);
      const lastX = pts[pts.length - 1].x;
      for (let k = 1; k <= 7; k++) {
        const d = new Date(lastDate); d.setDate(d.getDate() + k);
        const x = lastX + k;
        horizon.push({ date: d.toISOString().slice(0, 10), projected: Math.max(0, Math.round(fit.a * x + fit.b)) });
      }
    }

    res.json({
      dataset_id: id,
      synthetic,
      metrics: { r2: fit.r2, mse: fit.mse, mape: fit.mape },
      history: pts.map((p, i) => ({ date: String(p.date), actual: p.y, fitted: Math.max(0, Math.round(fit.yhat[i])) })),
      horizon
    });
  } catch (e) {
    console.error('regression_failed:', e);
    res.status(500).json({ message: 'regression_failed', detail: e.message });
  }
});

module.exports = router;