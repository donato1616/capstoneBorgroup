// backend/routes/dataset.js
const express = require('express');
const router = express.Router();

const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process'); // ML helpers

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
function isNumericish(s) {
  if (s === null || s === undefined) return false;
  const t = String(s).trim();
  if (!t) return false;
  if (/^[+\-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?$/.test(t)) return true;
  if (/^[+\-]?\d+(?:\.\d+)?%?$/.test(t)) return true;
  return false;
}
function coerceNumeric(s) {
  const t = String(s || '').trim();
  if (!isNumericish(t)) return null;
  const cleaned = t.replace(/[ ,%]/g, '');
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}
function normTextToken(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    .toUpperCase();
}

// --------- Human-friendly question label ---------
function prettyQuestionLabel(code, sampleText) {
  if (!code) return '';

  // 1) strip common survey prefixes & boilerplate
  let s = String(code)
    .replace(/^A_+/i, '')
    .replace(/^B_+/i, '')
    .replace(/^ISQ_+/i, '')
    .replace(/_?DISPLAYEDITPARAMETERSH_?\d*/i, '')
    .replace(/_?DISPLAYEDITPARAMETERS_?\d*/i, '')
    .replace(/^Q_+/i, 'Q')
    .replace(/__+/g, '_');

  // 2) expand a few very common acronyms/codes
  const dict = [
    [/^AGE1$/i, 'Age'],
    [/^GENDER1?$/i, 'Gender'],
    [/ALLQUALIFIEDRESP/gi, 'All Qualified Respondents'],
    [/_RESP\b/gi, ' Respondents'],
  ];
  for (const [re, repl] of dict) s = s.replace(re, repl);

  // 3) underscores -> spaces; compact spaces
  s = s.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // 4) make it Title Case (but leave Q-codes as is)
  s = s.split(' ').map(tok => {
    if (/^Q\d+[a-z]*$/i.test(tok)) return tok.toUpperCase();
    return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
  }).join(' ');

  // 5) add example answer as a hint (tiny, trimmed)
  if (sampleText) {
    const ex = String(sampleText).trim();
    if (ex) s = `${s} — e.g., ${ex.slice(0, 40)}`;
  }
  return s;
}

// --------- OLS helpers (shared by multiple endpoints) ---------
function olsFit(points) {
  const n = points.length;
  const sx = points.reduce((s,p)=>s+p.x,0);
  const sy = points.reduce((s,p)=>s+p.y,0);
  const sxx= points.reduce((s,p)=>s+p.x*p.x,0);
  const sxy= points.reduce((s,p)=>s+p.x*p.y,0);
  const denom = (n * sxx - sx * sx) || 1;
  const a = (n * sxy - sx * sy) / denom;
  const b = (sy - a * sx) / n;
  const yhat = points.map(p => a * p.x + b);
  const ybar = sy / n;

  const yhatClamp = yhat.map(v => Math.max(0, v));

  const mse   = points.reduce((s,p,i)=> s + Math.pow(p.y - yhatClamp[i], 2), 0) / n;
  const rmse  = Math.sqrt(mse);
  const ssRes = points.reduce((s,p,i)=> s + Math.pow(p.y - yhatClamp[i], 2), 0);
  const ssTot = points.reduce((s,p)=> s + Math.pow(p.y - ybar, 2), 0) || 1;
  const r2    = 1 - (ssRes / ssTot);

  const baselineMSE  = points.reduce((s,p)=> s + Math.pow(p.y - ybar, 2), 0) / n;
  const baselineRMSE = Math.sqrt(baselineMSE);
  const improvement  = baselineRMSE > 0 ? (1 - rmse / baselineRMSE) : null;

  const EPS = 1e-9;
  const mae  = points.reduce((s,p,i)=> s + Math.abs(p.y - Math.round(yhatClamp[i])), 0) / n;
  const wape = (points.reduce((s,p,i)=> s + Math.abs(p.y - Math.round(yhatClamp[i])), 0)) / ((points.reduce((s,p)=> s + Math.abs(p.y), 0)) || 1);

  const mapeArr = points.map((p,i)=> p.y !== 0 ? Math.abs((p.y - yhatClamp[i]) / p.y) : null).filter(v=>v!==null);
  const mape    = mapeArr.length ? (mapeArr.reduce((s,v)=>s+v,0)/mapeArr.length) : null;

  const MAPE_FLOOR = 5;
  const mapeFloorArr = points.map((p,i)=> p.y >= MAPE_FLOOR ? Math.abs((p.y - yhatClamp[i]) / p.y) : null).filter(v=>v!==null);
  const mape_floor5 = mapeFloorArr.length ? (mapeFloorArr.reduce((s,v)=>s+v,0)/mapeFloorArr.length) : null;

  const smapeArr = points.map((p,i)=>{
    const denom = Math.abs(p.y) + Math.abs(yhatClamp[i]) + EPS;
    return (2 * Math.abs(p.y - yhatClamp[i])) / denom;
  });
  const smape = smapeArr.reduce((s,v)=>s+v,0)/smapeArr.length;

  return { a, b, yhat: yhatClamp, r2, mse, rmse, baselineMSE, baselineRMSE, improvement, mae, wape, mape, mape_floor5, smape };
}
function makeHorizon(lastDateISO, lastX, a, b, steps=7, interval='day') {
  const out = [];
  const base = new Date(lastDateISO);
  for (let k=1; k<=steps; k++) {
    const d = new Date(base);
    if (interval === 'week') d.setDate(d.getDate() + 7*k);
    else if (interval === 'month') d.setMonth(d.getMonth() + k);
    else d.setDate(d.getDate() + k);
    const x = lastX + k;
    out.push({ date: d.toISOString().slice(0,10), projected: Math.max(0, Math.round(a*x + b)) });
  }
  return out;
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

    // deduplicate raw/clean JSON per respondent+date
    const firstJsonForKey = new Set();
    const keyOf = (f) => {
      const d = f.interviewDate ? new Date(f.interviewDate).toISOString().slice(0,10) : '';
      return `${f.respondentId}||${d}`;
    };

    // insert in batches
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

    // HARD completion
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

    // SOFT completion (density rule)
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

// ---------- CLEANED QDIST ----------
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

    const stop = new Set(['', 'N/A', 'NA', 'NONE', 'NULL', 'UNSPECIFIED', 'UNASSIGNED', '—', '-', 'NCL']);
    const texts = [];
    for (const r of rows) {
      const raw = (r.answerText ?? '').toString().trim();
      if (!raw) continue;
      if (isNumericish(raw)) continue;
      const token = normTextToken(raw);
      if (!token || token.length < 2 || stop.has(token)) continue;
      texts.push(token);
    }

    const numeric_bins = [];
    if (nums.length) {
      const min = Math.min(...nums), max = Math.max(...nums);
      const k = Math.min(25, Math.max(6, Math.ceil(Math.sqrt(nums.length))));
      const step = ((max - min) / (k || 1)) || 1;
      for (let i = 0; i < k; i++) {
        const lo = min + i * step;
        const hi = (i === k - 1) ? max : lo + step;
        const cnt = nums.reduce((s, v) => s + ((i === 0 ? v >= lo : v > lo) && v <= hi ? 1 : 0), 0);
        numeric_bins.push({ lo, hi, count: cnt });
      }
    }

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

// ---------------------------- predictive (respondents/day regression + better metrics) ----------------------------
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
        v: 3,
        dataset_id: id,
        synthetic,
        unit: 'respondents/day',
        metrics: {
          r2: null, mse: 0, rmse: 0,
          baseline_mse: null, baseline_rmse: null, improvement_vs_baseline: null,
          mae: null, wape: null, mape: null, mape_floor5: null, smape: null,
          oos_rmse: null, oos_mape: null, oos_smape: null, oos_r2: null
        },
        history: pts.map(p => ({ date: p.date, actual: p.y, fitted: p.y })),
        horizon: []
      });
    }

    const fit = olsFit(pts);

    // holdout (last 20%, min 2)
    let oos = { rmse: null, mape: null, smape: null, r2: null };
    if (!synthetic && n >= 5) {
      const h = Math.max(2, Math.floor(0.2 * n));
      const train = pts.slice(0, n - h);
      const test  = pts.slice(n - h);

      const tfit = olsFit(train);
      const testY    = test.map(p => p.y);
      const testYhat = test.map((p,i) => Math.max(0, tfit.a * p.x + tfit.b));

      const tmse  = testY.reduce((s,v,i)=> s + Math.pow(v - testYhat[i], 2), 0) / test.length;
      const trmse = Math.sqrt(tmse);

      const tmapeArr = testY.map((v,i)=> v !== 0 ? Math.abs((v - testYhat[i]) / v) : null).filter(v=>v!==null);
      const tmape    = tmapeArr.length ? (tmapeArr.reduce((s,v)=>s+v,0)/tmapeArr.length) : null;

      const EPS = 1e-9;
      const tsmapeArr= testY.map((v,i)=>{
        const denom = Math.abs(v) + Math.abs(testYhat[i]) + EPS;
        return (2 * Math.abs(v - testYhat[i])) / denom;
      });
      const tsmape = tsmapeArr.reduce((s,v)=>s+v,0) / tsmapeArr.length;

      const tybar = testY.reduce((s,v)=>s+v,0) / test.length;
      const tssRes = testY.reduce((s,v,i)=> s + Math.pow(v - testYhat[i], 2), 0);
      const tssTot = testY.reduce((s,v)=> s + Math.pow(v - tybar, 2), 0) || 1;
      const tr2    = 1 - (tssRes / tssTot);

      oos = { rmse: trmse, mape: tmape, smape: tsmape, r2: tr2 };
    }

    const horizon = makeHorizon(pts[pts.length - 1].date, pts[pts.length - 1].x, fit.a, fit.b, 7, 'day');

    res.json({
      v: 3,
      dataset_id: id,
      synthetic,
      unit: 'respondents/day',
      metrics: {
        r2: fit.r2, mse: fit.mse, rmse: fit.rmse,
        baseline_mse: fit.baselineMSE, baseline_rmse: fit.baselineRMSE,
        improvement_vs_baseline: fit.improvement,
        mae: fit.mae, wape: fit.wape,
        mape: fit.mape, mape_floor5: fit.mape_floor5, smape: fit.smape,
        oos_rmse: oos.rmse, oos_mape: oos.mape, oos_smape: oos.smape, oos_r2: oos.r2
      },
      history: pts.map((p,i)=>({ date: p.date, actual: p.y, fitted: Math.max(0, Math.round(fit.yhat[i])) })),
      horizon
    });
  } catch (e) {
    console.error('regression_failed:', e);
    res.status(500).json({ message: 'regression_failed', detail: e.message });
  }
});

// Compatibility alias used by some frontends: /forecast
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

    let pts = (daily || []).map((r, i) => ({
      x: i,
      y: Number(r.completed || 0),
      date: r.day
    }));

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

    const n = pts.length;
    const sx  = pts.reduce((s,p)=>s+p.x,0);
    const sy  = pts.reduce((s,p)=>s+p.y,0);
    const sxx = pts.reduce((s,p)=>s+p.x*p.x,0);
    const sxy = pts.reduce((s,p)=>s+p.x*p.y,0);
    const denom = (n*sxx - sx*sx) || 1;
    const a = (n*sxy - sx*sy)/denom;
    const b = (sy - a*sx)/n;

    const horizon = (function makeHorizon(lastDateISO, lastX, a, b, steps=7) {
      const out = [];
      const base = new Date(lastDateISO);
      for (let k=1; k<=steps; k++) {
        const d = new Date(base);
        d.setDate(d.getDate() + k);
        const x = lastX + k;
        out.push({ date: d.toISOString().slice(0,10), projected: Math.max(0, Math.round(a*x + b)) });
      }
      return out;
    })(pts[pts.length-1].date, pts[pts.length-1].x, a, b, 7);

    res.json({ dataset_id: id, metrics: {}, horizon });
  } catch (e) {
    console.error('forecast_failed:', e);
    res.status(500).json({ message: 'forecast_failed', detail: e.message });
  }
});

// ===== QUESTION-LEVEL PREDICTIVE =====

// 1) auto-classify questions by type (now returns a human-friendly "label")
router.get('/:id/questions/schema', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.$queryRaw`
      WITH b AS (
        SELECT "questionCode" AS q,
               COUNT(*)::int AS n,
               COUNT("answerNum")::int AS n_num,
               COUNT(NULLIF(TRIM(COALESCE("answerText",'')),''))::int AS n_text,
               COUNT(DISTINCT TRIM(UPPER(REGEXP_REPLACE(COALESCE("answerText",''), '\\s+', ' ', 'g'))))::int AS uniq_text
        FROM "ResponseFact"
        WHERE "datasetId" = ${id}
        GROUP BY "questionCode"
      ),
      s AS (
        SELECT DISTINCT ON ("questionCode")
               "questionCode", "answerText"
        FROM "ResponseFact"
        WHERE "datasetId" = ${id}
          AND "answerText" IS NOT NULL
        ORDER BY "questionCode", random()
      )
      SELECT b.q, b.n, b.n_num, b.n_text, b.uniq_text, COALESCE(s."answerText",'') AS sample_text
      FROM b LEFT JOIN s ON s."questionCode" = b.q
      WHERE b.q IS NOT NULL
      ORDER BY b.n DESC
      LIMIT 400
    `;
    const items = (rows || []).map(r => {
      const fracNum = r.n ? r.n_num / r.n : 0;
      let kind = 'text';
      if (fracNum >= 0.4) kind = 'numeric';
      else if (r.uniq_text <= 30 && r.uniq_text > 0) kind = 'categorical';
      const label = prettyQuestionLabel(r.q, r.sample_text);
      return {
        question: r.q,
        label,           // << human-friendly label for dropdowns
        total: r.n,
        numeric_rows: r.n_num,
        text_rows: r.n_text,
        unique_text: r.uniq_text,
        kind,
        sampleText: r.sample_text
      };
    });
    res.json({ items });
  } catch (e) {
    console.error('questions_schema_failed:', e);
    res.status(400).json({ message: 'questions_schema_failed', detail: e.message });
  }
});

// 2) numeric question forecast
// GET /api/dataset/:id/predict/question/numeric?questionCode=Q1&agg=sum|avg|count&interval=day|week|month
router.get('/:id/predict/question/numeric', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const q  = String(req.query.questionCode || '').trim();
    const agg = (String(req.query.agg || 'avg').toLowerCase());
    const interval = (String(req.query.interval || 'day').toLowerCase());
    if (!q) return res.status(400).json({ error: 'questionCode required' });
    if (!['sum','avg','count'].includes(agg)) return res.status(400).json({ error: 'agg must be sum|avg|count' });
    if (!['day','week','month'].includes(interval)) return res.status(400).json({ error: 'interval must be day|week|month' });

    const bucketExpr = interval === 'week' ? `DATE_TRUNC('week',"interviewDate")`
                      : interval === 'month' ? `DATE_TRUNC('month',"interviewDate")`
                      : `DATE_TRUNC('day',"interviewDate")`;

    const rows = await prisma.$queryRawUnsafe(`
      WITH base AS (
        SELECT
          ${bucketExpr}::date AS d,
          CASE
            WHEN "answerNum" IS NOT NULL THEN "answerNum"
            WHEN "answerText" ~ '^[\\s]*[+\\-]?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*%?[\\s]*$'
              THEN REGEXP_REPLACE(LOWER("answerText"), '[,%]', '', 'g')::numeric
            ELSE NULL
          END AS val
        FROM "ResponseFact"
        WHERE "datasetId" = $1 AND "questionCode" = $2 AND "interviewDate" IS NOT NULL
      )
      SELECT d::date AS day,
             COUNT(val) FILTER (WHERE val IS NOT NULL)::int AS n,
             SUM(val)::float8 AS sum,
             AVG(val)::float8 AS avg
      FROM base
      GROUP BY day
      ORDER BY day
    `, id, q);

    if (!rows || rows.length === 0) {
      return res.json({ dataset_id: id, question: q, interval, agg, history: [], horizon: [], metrics: {}, synthetic: true });
    }

    const series = rows.map(r => ({
      date: String(r.day),
      y: agg === 'sum' ? Number(r.sum || 0)
         : agg === 'count' ? Number(r.n || 0)
         : Number(r.avg || 0)
    })).filter(r => Number.isFinite(r.y));

    const pts = series.map((r,i)=>({ x:i, y:r.y, date:r.date }));
    if (pts.length < 2 || new Set(pts.map(p=>p.y)).size <= 1) {
      return res.json({
        dataset_id: id, question: q, agg, interval, synthetic: false,
        metrics: { r2:null, rmse:0, mape:null, smape:null, mape_floor5:null, baseline_rmse:null, improvement_vs_baseline:null },
        history: pts.map(p => ({ date: p.date, actual: p.y, fitted: p.y })),
        horizon: []
      });
    }

    const fit = olsFit(pts);
    const horizon = makeHorizon(pts[pts.length-1].date, pts[pts.length-1].x, fit.a, fit.b, 7, interval);

    res.json({
      dataset_id: id, question: q, agg, interval,
      synthetic: false,
      metrics: {
        r2: fit.r2, mse: fit.mse, rmse: fit.rmse,
        baseline_rmse: fit.baselineRMSE,
        improvement_vs_baseline: fit.improvement,
        mae: fit.mae, wape: fit.wape,
        mape: fit.mape, mape_floor5: fit.mape_floor5, smape: fit.smape
      },
      history: pts.map((p,i)=>({ date: p.date, actual: p.y, fitted: Math.max(0, Math.round(fit.yhat[i])) })),
      horizon
    });
  } catch (e) {
    console.error('q_numeric_forecast_failed:', e);
    res.status(500).json({ message: 'q_numeric_forecast_failed', detail: e.message });
  }
});

// 3) categorical/text question forecast
// GET /api/dataset/:id/predict/question/categorical?questionCode=Q1&top_k=5&interval=day|week|month&as_share=0|1
router.get('/:id/predict/question/categorical', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const q  = String(req.query.questionCode || '').trim();
    const topK = Math.max(1, Math.min(10, Number(req.query.top_k || 5)));
    const interval = (String(req.query.interval || 'day').toLowerCase());
    const asShare = String(req.query.as_share || '0') === '1';
    if (!q) return res.status(400).json({ error: 'questionCode required' });
    if (!['day','week','month'].includes(interval)) return res.status(400).json({ error: 'interval must be day|week|month' });

    const bucketExpr = interval === 'week' ? `DATE_TRUNC('week',"interviewDate")`
                      : interval === 'month' ? `DATE_TRUNC('month',"interviewDate")`
                      : `DATE_TRUNC('day',"interviewDate")`;

    const topLabels = await prisma.$queryRawUnsafe(`
      WITH base AS (
        SELECT TRIM(UPPER(REGEXP_REPLACE(COALESCE("answerText",''), '\\s+', ' ', 'g'))) AS label
        FROM "ResponseFact"
        WHERE "datasetId" = $1 AND "questionCode" = $2
          AND "interviewDate" IS NOT NULL
          AND "answerText" IS NOT NULL
          AND NOT ("answerText" ~ '^[\\s]*[+\\-]?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*%?[\\s]*$')
      )
      SELECT label, COUNT(*)::int AS c
      FROM base
      WHERE label <> ''
      GROUP BY label
      ORDER BY c DESC
      LIMIT $3
    `, id, q, topK);
    if (!topLabels || topLabels.length === 0) {
      return res.json({ dataset_id: id, question: q, interval, top_k: topK, series: {}, horizon: {}, synthetic: false, labels: [] });
    }
    const labels = topLabels.map(r => r.label);

    const rows = await prisma.$queryRawUnsafe(`
      WITH base AS (
        SELECT
          ${bucketExpr}::date AS d,
          TRIM(UPPER(REGEXP_REPLACE(COALESCE("answerText",''), '\\s+', ' ', 'g'))) AS label
        FROM "ResponseFact"
        WHERE "datasetId" = $1 AND "questionCode" = $2
          AND "interviewDate" IS NOT NULL
          AND "answerText" IS NOT NULL
          AND NOT ("answerText" ~ '^[\\s]*[+\\-]?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*%?[\\s]*$')
      ),
      tot AS ( SELECT d, COUNT(*)::int AS total FROM base GROUP BY d ),
      fil AS ( SELECT * FROM base WHERE label = ANY($3::text[]) )
      SELECT f.d::date AS day, f.label, COUNT(*)::int AS c, t.total
      FROM fil f
      JOIN tot t ON t.d = f.d
      GROUP BY f.d, f.label, t.total
      ORDER BY f.d, f.label
    `, id, q, labels);

    const byLabel = new Map();
    for (const L of labels) byLabel.set(L, []);
    for (const r of rows) {
      const y = asShare ? (r.total ? (r.c / r.total) : 0) : r.c;
      byLabel.get(r.label).push({ date: String(r.day), y: Number(y) });
    }

    const series = {};
    const horizon = {};
    const metrics = {};
    for (const L of labels) {
      const arr = byLabel.get(L) || [];
      const pts = arr.map((r,i)=>({ x:i, y:r.y, date:r.date }));
      if (pts.length < 2 || new Set(pts.map(p=>p.y)).size <= 1) {
        series[L] = pts.map(p=>({ date:p.date, actual:p.y, fitted:p.y }));
        horizon[L] = [];
        metrics[L] = { r2:null, rmse:0, mape:null, smape:null, mape_floor5:null, baseline_rmse:null, improvement_vs_baseline:null };
        continue;
      }
      const fit = olsFit(pts);
      series[L] = pts.map((p,i)=>({ date:p.date, actual:p.y, fitted: Math.max(0, Math.round(fit.yhat[i])) }));
      horizon[L] = makeHorizon(pts[pts.length-1].date, pts[pts.length-1].x, fit.a, fit.b, 7, interval)
                     .map(h => ({ ...h, projected: asShare ? Math.min(1, h.projected) : h.projected }));
      metrics[L] = {
        r2: fit.r2, rmse: fit.rmse, mse: fit.mse,
        baseline_rmse: fit.baselineRMSE, improvement_vs_baseline: fit.improvement,
        mae: fit.mae, wape: fit.wape, mape: fit.mape, mape_floor5: fit.mape_floor5, smape: fit.smape
      };
    }

    res.json({
      dataset_id: id, question: q, interval, top_k: topK, as_share: asShare ? 1 : 0,
      labels, series, horizon, metrics
    });
  } catch (e) {
    console.error('q_categorical_forecast_failed:', e);
    res.status(500).json({ message: 'q_categorical_forecast_failed', detail: e.message });
  }
});

// ==================== PRESCRIPTIVE ROUTES ====================

// GET /api/dataset/:id/prescriptive/staffing?target=200&deadline=YYYY-MM-DD&rate=8&workdays=6
// Simple capacity-based planner: compute # of interviewers needed and a flat daily plan.
router.get('/:id/prescriptive/staffing', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const target = Math.max(1, Number(req.query.target || 0));
    const rate = Math.max(1, Number(req.query.rate || 8));          // interviews per interviewer per day
    const workdays = Math.min(7, Math.max(1, Number(req.query.workdays || 6)));
    const deadlineStr = String(req.query.deadline || '').slice(0, 10);
    if (!deadlineStr || isNaN(Date.parse(deadlineStr))) {
      return res.status(400).json({ error: 'deadline (YYYY-MM-DD) required' });
    }

    const today = new Date(); today.setHours(0,0,0,0);
    const deadline = new Date(deadlineStr + "T00:00:00");
    if (deadline < today) return res.status(400).json({ error: 'deadline must be today or later' });

    // count available workdays between today and deadline, respecting workdays/week
    // naive approach: assume Sat/Sun off if workdays<=5, else all days except 7-workdays off from weekend-first
    let availableDates = [];
    const cur = new Date(today);
    while (cur <= deadline) {
      const dow = cur.getDay(); // 0 Sun..6 Sat
      let isWorkday = true;
      if (workdays <= 5) {
        // Mon-Fri only
        isWorkday = dow >= 1 && dow <= 5;
      } else if (workdays === 6) {
        // Mon-Sat
        isWorkday = dow >= 1 && dow <= 6;
      } else {
        // 7 -> all days
        isWorkday = true;
      }
      if (isWorkday) {
        availableDates.push(cur.toISOString().slice(0,10));
      }
      cur.setDate(cur.getDate() + 1);
    }
    const available_workdays = availableDates.length || 1;

    // capacity math
    const required_interviewers = Math.max(1, Math.ceil(target / (rate * available_workdays)));
    const max_capacity = required_interviewers * rate * available_workdays;

    // flat daily plan until target reached
    const perDay = Math.max(1, Math.floor(target / available_workdays));
    let remaining = target;
    const daily_plan = availableDates.map(d => {
      const todayCompletes = Math.min(perDay, remaining);
      remaining -= todayCompletes;
      return { date: d, interviewers: required_interviewers, expected_completes: todayCompletes };
    });
    if (remaining > 0 && daily_plan.length) {
      // push remainder to the last day
      daily_plan[daily_plan.length - 1].expected_completes += remaining;
      remaining = 0;
    }

    res.json({
      dataset_id: id,
      target,
      rate,
      workdays,
      deadline: deadlineStr,
      available_workdays,
      required_interviewers,
      max_capacity,
      daily_plan
    });
  } catch (e) {
    console.error('prescriptive_staffing_failed:', e);
    res.status(500).json({ message: 'prescriptive_staffing_failed', detail: e.message });
  }
});

// GET /api/dataset/:id/prescriptive/region-allocation?target=200
// Allocate the target to regions by historical completion share (fallback equal split).
router.get('/:id/prescriptive/region-allocation', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const target = Math.max(1, Number(req.query.target || 0));

    const rows = await prisma.$queryRaw`
      SELECT COALESCE(region,'Unspecified') AS region,
             COUNT(DISTINCT "respondentId")::int AS cnt
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY region
      ORDER BY cnt DESC
      LIMIT 20
    `;
    let items = [];
    if (!rows || rows.length === 0) {
      // equal split fallback across one bucket
      items = [{ region: 'Overall', cnt: 1 }];
    } else {
      items = rows.map(r => ({ region: r.region, cnt: Number(r.cnt || 0) }));
    }
    const total = items.reduce((s, r) => s + (r.cnt || 0), 0) || items.length;
    const withShare = items.map(r => ({ ...r, share: (r.cnt || 0) / total }));

    // round allocation while preserving total
    let assigned = withShare.map(r => ({ region: r.region, share: r.share, assigned: Math.floor(r.share * target) }));
    let remainder = target - assigned.reduce((s, r) => s + r.assigned, 0);
    // give remainders to top shares
    assigned.sort((a,b)=>b.share - a.share);
    for (let i=0; i<assigned.length && remainder>0; i++, remainder--) {
      assigned[i].assigned += 1;
    }
    // restore original order by share desc
    assigned.sort((a,b)=>b.share - a.share);

    res.json({ dataset_id: id, target, items: assigned });
  } catch (e) {
    console.error('prescriptive_region_failed:', e);
    res.status(500).json({ message: 'prescriptive_region_failed', detail: e.message });
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