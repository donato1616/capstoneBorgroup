// backend/routes/dataset.js
const express = require('express');
const router = express.Router();

const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process'); // <-- required by your ML routes

const { PrismaClient } = require('@prisma/client');
const { chooseMapping, readBestSheet } = require('../etl/loader');
const { consolidateRows } = require('../etl/transform');

const prisma = new PrismaClient();

// ---------------------------- config knobs ----------------------------
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 200);
const INSERT_CHUNK = Number(process.env.INSERT_CHUNK || 5000);
const USE_TX = String(process.env.USE_TX || '0') === '1';
const SKIP_DUPLICATES = String(process.env.SKIP_DUPLICATES || '1') === '1';
const UPLOAD_STORAGE = (process.env.UPLOAD_STORAGE || 'disk').toLowerCase(); // 'disk' | 'memory'
// Completion density threshold (soft fallback). Make it adjustable for defense.
const COMPLETION_DENSITY_PCT = Number(process.env.COMPLETION_DENSITY_PCT || 0.7);

// ---------------------------- upload middlewares ----------------------------
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

const diskUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dest = path.join(os.tmpdir(), 'uploads');
      fs.mkdir(dest, { recursive: true }, () => cb(null, dest));
    },
    filename: (req, file, cb) => {
      const safe = String(file.originalname || 'upload').replace(/[^\w.\-]+/g, '_');
      cb(null, `${Date.now()}_${safe}`);
    }
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

function getUploadMiddleware() {
  return UPLOAD_STORAGE === 'memory' ? memoryUpload.single('file') : diskUpload.single('file');
}

// ---------------------------- helpers ----------------------------
function parseId(reqParam) {
  const n = Number(String(reqParam || '').trim());
  if (!Number.isFinite(n)) throw new Error('Invalid dataset id');
  return n;
}

function readFileToBuffer(file) {
  if (file?.buffer) return file.buffer;
  if (file?.path) return fs.readFileSync(file.path);
  return null;
}

// Numeric-ish detector for cleaning text tops (and coercing numeric text → number)
function isNumericish(s) {
  if (s === null || s === undefined) return false;
  const t = String(s).trim();
  if (!t) return false;
  // Allow +/-, thousands separators, decimals, optional percent
  if (/^[+\-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?$/.test(t)) return true;
  if (/^[+\-]?\d+(?:\.\d+)?%?$/.test(t)) return true;
  return false;
}

function coerceNumeric(s) {
  const t = String(s || '').trim();
  if (!isNumericish(t)) return null;
  // Keep as “human scale” (50% -> 50) for bins that match what users expect
  const cleaned = t.replace(/[ ,%]/g, '');
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

// Light text normalizer to consolidate tokens
function normTextToken(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    .toUpperCase();
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

// ---------------------------- upload (with perf & robustness) ----------------------------
router.post('/upload', getUploadMiddleware(), async (req, res) => {
  const T0 = Date.now();
  let T = T0;
  const tick = (label) => { const now = Date.now(); console.log(`[upload] +${now - T}ms ${label}`); T = now; };

  try {
    if (!req.file?.buffer && !req.file?.path) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fname = req.file.originalname || 'upload.xlsx';
    tick(`received: ${fname} (${req.file.size || 0} bytes)`);

    const lower = fname.toLowerCase();
    const isCsv = lower.endsWith('.csv');
    const isXlsx = lower.endsWith('.xlsx') || lower.endsWith('.xls');
    if (!isCsv && !isXlsx) return res.status(400).json({ error: 'Only .csv or .xlsx/.xls allowed' });

    const fileBuf = readFileToBuffer(req.file);
    tick(`read file into buffer (${fileBuf?.length || 0} bytes)`);

    // dataset row
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
    tick(`created dataset row id=${ds.id}`);

    // parse workbook
    let rows, sheetName, normMap;
    try {
      const r = readBestSheet(fileBuf, fname, chooseMapping(fname));
      rows = r.rows; sheetName = r.sheetName; normMap = r.normMap;
    } catch (e) {
      return res.status(400).json({ error: 'Failed to parse file', detail: e.message });
    } finally {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
    }
    tick(`parsed workbook: sheet="${sheetName}", rows=${rows?.length || 0}`);

    if (!rows?.length) return res.status(400).json({ error: 'No data rows detected' });

    // transform -> facts
    let facts = [], issues = [];
    try {
      const out = consolidateRows(rows, {}, normMap);
      facts = out.facts || []; issues = out.issues || [];
    } catch (e) {
      return res.status(500).json({ error: 'Transform failed', detail: e.message });
    }
    tick(`transformed to facts=${facts.length} (issues=${issues.length})`);

    // deduplicate raw/clean JSON per respondent+date (massive write reduction)
    const firstJsonForKey = new Set();
    const keyOf = (f) => {
      const d = f.interviewDate ? new Date(f.interviewDate).toISOString().slice(0,10) : '';
      return `${f.respondentId}||${d}`;
    };

    // insert in batches, optionally in one transaction
    const doInsertBatches = async (client) => {
      for (let i = 0; i < facts.length; i += INSERT_CHUNK) {
        const chunk = facts.slice(i, i + INSERT_CHUNK);
        const mapped = chunk.map(f => {
          const key = keyOf(f);
          const include = !firstJsonForKey.has(key);
          if (include) firstJsonForKey.add(key);
          return {
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
            rawJson: include ? f.rawJson : null,
            cleanJson: include ? f.cleanJson : null
          };
        });

        await client.responseFact.createMany({
          data: mapped,
          skipDuplicates: SKIP_DUPLICATES
        });
        tick(`inserted ${Math.min(i + mapped.length, facts.length)}/${facts.length}`);
      }
    };

    if (USE_TX) {
      await prisma.$transaction(async (tx) => { await doInsertBatches(tx); });
    } else {
      await doInsertBatches(prisma);
    }

    console.log(`[upload] total: ${Date.now() - T0}ms`);

    res.json({
      status: 'ok',
      dataset_id: ds.id,
      sheet: sheetName,
      inserted_facts: facts.length,
      issues_count: issues.length,
      file_info: { name: fname, size_bytes: req.file.size, mimetype: req.file.mimetype }
    });
  } catch (e) {
    if (e && e.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'file_too_large',
        message: `File exceeds ${MAX_UPLOAD_MB} MB limit`,
        max_mb: MAX_UPLOAD_MB
      });
    }
    console.error('upload failed', e);
    res.status(500).json({ error: 'Upload/ETL failed', detail: e.message });
  }
});

// ---------------------------- delete (and delete-fallback) ----------------------------
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

// ==================== SUMMARY & ANALYTICS ROUTES ====================
router.get('/:id/summary', async (req, res) => {
  try {
    const id = parseId(req.params.id);

    const totalRes = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT "respondentId")::int AS n
      FROM "ResponseFact" WHERE "datasetId" = ${id}
    `;
    const respondent_count = totalRes?.[0]?.n || 0;

    const fact_count = await prisma.responseFact.count({ where: { datasetId: id } });

    // HARD completion: dated or explicit flag
    const completedHard = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT "respondentId")::int AS n
      FROM "ResponseFact"
      WHERE "datasetId" = ${id}
        AND (
          "interviewDate" IS NOT NULL
          OR lower(
               COALESCE(
                 "cleanJson"->>'completed',
                 "rawJson"  ->>'completed',
                 "rawJson"  ->>'Completion',
                 "rawJson"  ->>'Completed',
                 "rawJson"  ->>'Status'
               )
             ) ~ '(?:^|\\b)(1|true|yes|completed|complete|done|finished|ok)(?:\\b|$)'
        )
    `;
    const hard = completedHard?.[0]?.n || 0;

    // SOFT completion: density >= COMPLETION_DENSITY_PCT * max(per-respondent facts)
    const soft = hard > 0 ? 0 : (await prisma.$queryRaw`
      WITH per AS (
        SELECT "respondentId", COUNT(*)::int AS c
        FROM "ResponseFact" WHERE "datasetId" = ${id}
        GROUP BY "respondentId"
      ),
      m AS (SELECT MAX(c) AS mx FROM per)
      SELECT COUNT(*)::int AS n
      FROM per, m
      WHERE per.c >= GREATEST(1, FLOOR(${COMPLETION_DENSITY_PCT} * m.mx))
    `)?.[0]?.n || 0;

    const completed_respondents = hard > 0 ? hard : soft;
    const completion_method = hard > 0 ? 'dated_or_flagged' : `soft_density_${Math.round(COMPLETION_DENSITY_PCT*100)}pct`;
    const completed_pct = respondent_count ? (100 * completed_respondents / respondent_count) : 0;

    const by_region_facts = await prisma.$queryRaw`
      SELECT COALESCE(region,'Unspecified') AS region, COUNT(*)::int AS facts
      FROM "ResponseFact" WHERE "datasetId" = ${id}
      GROUP BY region
      ORDER BY facts DESC
      LIMIT 10
    `;

    const top_questions = await prisma.$queryRaw`
      SELECT "questionCode" AS question, COUNT(*)::int AS c
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "questionCode" IS NOT NULL
      GROUP BY "questionCode"
      HAVING COUNT(*) > 0
      ORDER BY c DESC
      LIMIT 60
    `;

    res.json({
      dataset_id: id,
      respondent_count,
      fact_count,
      completed_respondents,
      completed_pct,
      completion_method,
      by_region_facts: by_region_facts || [],
      top_questions: top_questions || []
    });
  } catch (e) {
    console.error('summary_failed:', e);
    res.status(400).json({ message: 'summary_failed', detail: e.message });
  }
});

router.get('/:id/questions', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.$queryRaw`
      SELECT "questionCode" AS question, COUNT(*)::int AS n
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "questionCode" IS NOT NULL
      GROUP BY "questionCode"
      ORDER BY n DESC
      LIMIT 120
    `;
    res.json({ items: rows || [] });
  } catch (e) {
    console.error('questions_failed:', e);
    res.status(400).json({ message: 'questions_failed', detail: e.message });
  }
});

router.get('/:id/questions/with-sample', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.$queryRaw`
      WITH q AS (
        SELECT "questionCode", COUNT(*)::int c
        FROM "ResponseFact" WHERE "datasetId" = ${id}
        GROUP BY "questionCode"
      ),
      s AS (
        SELECT DISTINCT ON ("questionCode")
               "questionCode", "answerText"
        FROM "ResponseFact" WHERE "datasetId" = ${id}
          AND "answerText" IS NOT NULL
        ORDER BY "questionCode", random()
      )
      SELECT q."questionCode" AS question, q.c AS n, COALESCE(s."answerText",'') AS sampleText
      FROM q LEFT JOIN s ON q."questionCode" = s."questionCode"
      ORDER BY n DESC
      LIMIT 120
    `;
    res.json({ items: rows || [] });
  } catch (e) {
    console.error('questions_sample_failed:', e);
    res.status(400).json({ message: 'questions_sample_failed', detail: e.message });
  }
});

// ---------- CLEANED QDIST (numeric coercion + text de-noising) ----------
router.get('/:id/qdist', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const q = String(req.query.questionCode || '').trim();
    if (!q) return res.status(400).json({ error: 'questionCode required' });

    const rows = await prisma.responseFact.findMany({
      where: { datasetId: id, questionCode: q },
      select: { answerText: true, answerNum: true },
      take: 100000
    });

    // Build numeric series (include numeric-like strings from answerText)
    const nums = [];
    for (const r of rows) {
      if (r.answerNum !== null && r.answerNum !== undefined) {
        const v = Number(r.answerNum);
        if (Number.isFinite(v)) nums.push(v);
      } else if (r.answerText && isNumericish(r.answerText)) {
        const v = coerceNumeric(r.answerText);
        if (v !== null) nums.push(v);
      }
    }

    // Build cleaned text series (exclude numeric-only strings)
    const stop = new Set(['', 'N/A', 'NA', 'NONE', 'NULL', 'UNSPECIFIED', 'UNASSIGNED', '—', '-', 'NCL']);
    const texts = [];
    for (const r of rows) {
      const raw = (r.answerText ?? '').toString().trim();
      if (!raw) continue;
      if (isNumericish(raw)) continue; // keep digits out of text tops
      const token = normTextToken(raw);
      if (!token || token.length < 2 || stop.has(token)) continue;
      texts.push(token);
    }

    // Numeric hist: 6..25 bins using sqrt rule (bounded)
    const numeric_bins = [];
    if (nums.length) {
      const min = Math.min(...nums), max = Math.max(...nums);
      const k = Math.min(25, Math.max(6, Math.ceil(Math.sqrt(nums.length))));
      const step = ((max - min) / (k || 1)) || 1;
      for (let i = 0; i < k; i++) {
        const lo = min + i * step;
        const hi = (i === k - 1) ? max : lo + step;
        // left-open except first bin to avoid double counts on edges
        const cnt = nums.reduce((s, v) => s + ((i === 0 ? v >= lo : v > lo) && v <= hi ? 1 : 0), 0);
        numeric_bins.push({ lo, hi, count: cnt });
      }
    }

    // Text top 50
    const tf = new Map();
    for (const t of texts) tf.set(t, (tf.get(t) || 0) + 1);
    const text_top = Array.from(tf.entries())
      .sort((a,b)=>b[1]-a[1])
      .slice(0, 50)
      .map(([label, count]) => ({ label, count }));

    res.json({ numeric_bins, text_top });
  } catch (e) {
    console.error('qdist_failed:', e);
    res.status(400).json({ message: 'qdist_failed', detail: e.message });
  }
});

router.get('/:id/by-region-completed', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const hardRows = await prisma.$queryRaw`
      SELECT COALESCE(region,'Unspecified') AS region,
             COUNT(DISTINCT "respondentId")::int AS completed
      FROM "ResponseFact"
      WHERE "datasetId" = ${id}
        AND (
          "interviewDate" IS NOT NULL
          OR lower(
               COALESCE(
                 "cleanJson"->>'completed',
                 "rawJson"  ->>'completed',
                 "rawJson"  ->>'Completion',
                 "rawJson"  ->>'Completed',
                 "rawJson"  ->>'Status'
               )
             ) ~ '(?:^|\\b)(1|true|yes|completed|complete|done|finished|ok)(?:\\b|$)'
        )
      GROUP BY region
      ORDER BY completed DESC
      LIMIT 12
    `;
    if (hardRows.length > 0) return res.json({ items: hardRows });

    const softRows = await prisma.$queryRaw`
      WITH per AS (
        SELECT "respondentId",
               COALESCE(region,'Unspecified') AS region,
               COUNT(*)::int AS c
        FROM "ResponseFact"
        WHERE "datasetId" = ${id}
        GROUP BY "respondentId", region
      ),
      m AS (SELECT MAX(c) AS mx FROM per)
      SELECT region, COUNT(*)::int AS completed
      FROM per, m
      WHERE per.c >= GREATEST(1, FLOOR(${COMPLETION_DENSITY_PCT} * m.mx))
      GROUP BY region
      ORDER BY completed DESC
      LIMIT 12
    `;
    res.json({ items: softRows || [] });
  } catch (e) {
    console.error('region_completed_failed:', e);
    res.status(400).json({ message: 'region_completed_failed', detail: e.message });
  }
});

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

// ---------------------------- predictive (regression + baseline + holdout) ----------------------------
router.get('/:id/predict/regression', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new Error('Invalid dataset id');

    const daily = await prisma.$queryRaw`
      SELECT DATE("interviewDate") AS day,
             COUNT(DISTINCT "respondentId")::int AS completed
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY day
      ORDER BY day
    `;
    let pts = (daily || []).map((r, i) => ({ x: i, y: Number(r.completed || 0), date: String(r.day) }));
    let synthetic = false;

    if (pts.length < 2) {
      let total = 0;
      const td = await prisma.$queryRaw`
        SELECT COUNT(DISTINCT "respondentId")::int AS n
        FROM "ResponseFact" WHERE "datasetId" = ${id}
      `;
      total = td?.[0]?.n || 0;
      if (total === 0) {
        const est = await prisma.$queryRaw`
          SELECT COUNT(*)::int AS facts,
                 NULLIF(COUNT(DISTINCT "questionCode"),0)::int AS qdim
          FROM "ResponseFact" WHERE "datasetId" = ${id}
        `;
        const facts = est?.[0]?.facts || 0;
        const qdim  = est?.[0]?.qdim  || 0;
        if (qdim > 0) total = Math.max(0, Math.round(facts / qdim));
      }
      const days = Math.min(7, Math.max(3, Math.ceil(Math.sqrt(Math.max(2, total)))));
      const weights = Array.from({ length: days }, (_, i) => i + 1);
      const sumW = weights.reduce((s, w) => s + w, 0) || 1;
      const vals = weights.map(w => Math.round((w / sumW) * total));
      let diff = total - vals.reduce((s, v) => s + v, 0);
      let idx = days - 1; while (diff-- > 0) { vals[idx]++; idx = (idx - 1 + days) % days; }
      const today = new Date();
      pts = Array.from({ length: days }, (_, i) => {
        const d = new Date(today); d.setDate(d.getDate() - (days - i));
        return { x: i, y: vals[i], date: d.toISOString().slice(0,10) };
      });
      synthetic = true;
    }

    const uniqueY = new Set(pts.map(p => p.y)).size;
    const n = pts.length;
    if (n < 2 || uniqueY <= 1) {
      return res.json({
        v: 2,
        dataset_id: id,
        synthetic,
        unit: 'respondents/day',
        metrics: { r2: null, mse: 0, rmse: 0, baseline_mse: null, baseline_rmse: null, improvement_vs_baseline: null, mape: null, oos_rmse: null, oos_mape: null, oos_r2: null },
        history: pts.map(p => ({ date: p.date, actual: p.y, fitted: p.y })),
        horizon: []
      });
    }

    // OLS fit
    const sum = f => pts.reduce((s, p) => s + f(p), 0);
    const sx = sum(p => p.x), sy = sum(p => p.y);
    const sxx = sum(p => p.x * p.x), sxy = sum(p => p.x * p.y);
    const denom = (n * sxx - sx * sx) || 1;
    const a = (n * sxy - sx * sy) / denom;
    const b = (sy - a * sx) / n;
    const yhat = pts.map(p => a * p.x + b);
    const ybar = sy / n;

    const ssRes = pts.reduce((s, p, i) => s + Math.pow(p.y - yhat[i], 2), 0);
    const ssTot = pts.reduce((s, p) => s + Math.pow(p.y - ybar, 2), 0) || 1;
    const mse = ssRes / n;
    const r2  = 1 - (ssRes / ssTot);
    const rmse = Math.sqrt(mse);
    const mape = (() => {
      const ape = pts.filter((p,i)=>p.y!==0).map((p,i)=>Math.abs((p.y - yhat[i]) / p.y));
      return ape.length ? (ape.reduce((s,v)=>s+v,0)/ape.length) : null;
    })();

    const baselineMSE  = pts.reduce((s,p)=>s+Math.pow(p.y - ybar,2),0) / n;
    const baselineRMSE = Math.sqrt(baselineMSE);
    const improvement  = baselineRMSE > 0 ? (1 - rmse / baselineRMSE) : null;

    // holdout (last 20%, min 2)
    let oos_rmse = null, oos_mape = null, oos_r2 = null;
    if (!synthetic && n >= 5) {
      const h = Math.max(2, Math.floor(0.2 * n));
      const train = pts.slice(0, n - h);
      const test  = pts.slice(n - h);

      const tsx = train.reduce((s,p)=>s+p.x,0);
      const tsy = train.reduce((s,p)=>s+p.y,0);
      const tsxx= train.reduce((s,p)=>s+p.x*p.x,0);
      const tsxy= train.reduce((s,p)=>s+p.x*p.y,0);
      const tden= (train.length * tsxx - tsx*tsx) || 1;
      const ta  = (train.length * tsxy - tsx*tsy) / tden;
      const tb  = (tsy - ta * tsx) / train.length;

      const testY    = test.map(p => p.y);
      const testYhat = test.map(p => ta * p.x + tb);
      const tybar = testY.reduce((s,v)=>s+v,0) / test.length;

      const tssRes = testY.reduce((s,v,i)=>s+Math.pow(v - testYhat[i],2),0);
      const tssTot = testY.reduce((s,v)=>s+Math.pow(v - tybar,2),0) || 1;
      oos_rmse = Math.sqrt(tssRes / test.length);
      oos_r2   = 1 - (tssRes / tssTot);
      const tape = testY.filter((v,i)=>v!==0).map((v,i)=>Math.abs((v - testYhat[i])/v));
      oos_mape = tape.length ? (tape.reduce((s,v)=>s+v,0)/tape.length) : null;
    }

    // horizon
    const horizon = [];
    const lastDate = new Date(pts[pts.length - 1].date);
    const lastX = pts[pts.length - 1].x;
    for (let k = 1; k <= 7; k++) {
      const d = new Date(lastDate); d.setDate(d.getDate() + k);
      const x = lastX + k;
      horizon.push({ date: d.toISOString().slice(0, 10), projected: Math.max(0, Math.round(a * x + b)) });
    }

    res.json({
      v: 2,
      dataset_id: id,
      synthetic,
      unit: 'respondents/day',
      metrics: {
        r2, mse, rmse,
        baseline_mse: baselineMSE,
        baseline_rmse: baselineRMSE,
        improvement_vs_baseline: improvement,
        mape,
        oos_rmse, oos_mape, oos_r2
      },
      history: pts.map((p,i)=>({ date: p.date, actual: p.y, fitted: Math.max(0, Math.round(yhat[i])) })),
      horizon
    });
  } catch (e) {
    console.error('regression_failed:', e);
    res.status(500).json({ message: 'regression_failed', detail: e.message });
  }
});

// Compatibility alias used by some frontends: /forecast
router.get('/:id/forecast', async (req, res) => {
  try {
    const id = parseId(req.params.id);

    const daily = await prisma.$queryRaw`
      SELECT DATE("interviewDate") AS day,
             COUNT(DISTINCT "respondentId")::int AS completed
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY day
      ORDER BY day
    `;
    let pts = (daily || []).map((r, i) => ({ x: i, y: Number(r.completed || 0), date: r.day }));

    if (pts.length < 2) {
      const totalDistinct = await prisma.$queryRaw`
        SELECT COUNT(DISTINCT "respondentId")::int AS n
        FROM "ResponseFact" WHERE "datasetId" = ${id}
      `;
      const total = totalDistinct?.[0]?.n || 0;
      const today = new Date();
      const hist = Array.from({ length: 5 }, (_, i) => {
        const d = new Date(today); d.setDate(d.getDate() - (5 - i));
        return { date: d.toISOString().slice(0, 10), value: Math.round(total / 5) };
      });
      pts = hist.map((h, i) => ({ x: i, y: h.value, date: h.date }));
    }

    // simple fit
    const n = pts.length;
    const sx = pts.reduce((s,p)=>s+p.x,0);
    const sy = pts.reduce((s,p)=>s+p.y,0);
    const sxx= pts.reduce((s,p)=>s+p.x*p.x,0);
    const sxy= pts.reduce((s,p)=>s+p.x*p.y,0);
    const denom = (n*sxx - sx*sx) || 1;
    const a = (n*sxy - sx*sy)/denom;
    const b = (sy - a*sx)/n;

    const horizon = [];
    const lastDate = new Date(pts[pts.length - 1].date);
    const lastX = pts[pts.length - 1].x;
    for (let k = 1; k <= 7; k++) {
      const d = new Date(lastDate); d.setDate(d.getDate() + k);
      const x = lastX + k;
      horizon.push({ date: d.toISOString().slice(0, 10), projected: Math.max(0, Math.round(a * x + b)) });
    }

    res.json({ dataset_id: id, metrics: {}, horizon });
  } catch (e) {
    console.error('forecast_failed:', e);
    res.status(500).json({ message: 'forecast_failed', detail: e.message });
  }
});

// ---------------------------- preview/debug ----------------------------
router.get('/:id/preview', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.responseFact.findMany({
      where: { datasetId: id },
      orderBy: { id: 'asc' },
      take: 20,
      select: {
        respondentId: true, interviewDate: true, region: true, city: true,
        interviewer: true, questionCode: true, answerText: true, answerNum: true
      }
    });
    res.json({ items: rows || [] });
  } catch (e) {
    res.status(400).json({ message: 'preview_failed', detail: e.message });
  }
});

// ---------------------------- Python-backed ML routes (unchanged) ----------------------------
router.post('/predict/linear-regression', async (req, res) => {
  try {
    const { X_data, y_data } = req.body;
    const py = spawn('python', ['./etl/linear_regression.py', '--X_data', JSON.stringify(X_data), '--y_data', JSON.stringify(y_data)]);
    let out = '', err = '';
    py.stdout.on('data', d => out += d.toString());
    py.stderr.on('data', d => err += d.toString());
    py.on('close', (code) => {
      if (code !== 0) return res.status(500).json({ error: 'Linear Regression failed', detail: err });
      const result = JSON.parse(out);
      res.json(result);
    });
  } catch (e) {
    res.status(500).json({ error: 'Error in Linear Regression', detail: e.message });
  }
});

router.post('/predict/arima', async (req, res) => {
  try {
    const { timeSeriesData } = req.body;
    const py = spawn('python', ['./etl/arima_forecast.py', '--timeSeriesData', JSON.stringify(timeSeriesData)]);
    let out = '', err = '';
    py.stdout.on('data', d => out += d.toString());
    py.stderr.on('data', d => err += d.toString());
    py.on('close', (code) => {
      if (code !== 0) return res.status(500).json({ error: 'ARIMA forecasting failed', detail: err });
      res.json(JSON.parse(out));
    });
  } catch (e) {
    res.status(500).json({ error: 'Error in ARIMA forecasting', detail: e.message });
  }
});

router.post('/predict/logistic-regression', async (req, res) => {
  try {
    const { X_data, y_data } = req.body;
    const py = spawn('python', ['./etl/logistic_regression.py', '--X_data', JSON.stringify(X_data), '--y_data', JSON.stringify(y_data)]);
    let out = '', err = '';
    py.stdout.on('data', d => out += d.toString());
    py.stderr.on('data', d => err += d.toString());
    py.on('close', (code) => {
      if (code !== 0) return res.status(500).json({ error: 'Logistic Regression failed', detail: err });
      res.json(JSON.parse(out));
    });
  } catch (e) {
    res.status(500).json({ error: 'Error in Logistic Regression', detail: e.message });
  }
});

// --- Multer-specific error handler for this router ---
router.use((err, req, res, next) => {
  if (err && err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'file_too_large',
        message: `File exceeds ${MAX_UPLOAD_MB} MB limit`,
        max_mb: MAX_UPLOAD_MB
      });
    }
    return res.status(400).json({ error: 'upload_error', code: err.code, message: err.message });
  }
  next(err);
});

module.exports = router;