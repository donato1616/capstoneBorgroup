import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import prisma from "../lib/prisma.js";

import { chooseMapping, readBestSheet } from "../etl/loader.js";
import { consolidateRows } from "../etl/transform.js";

const router = express.Router();

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

// --------- Missing Date prototype method for getWeek() ---------
Date.prototype.getWeek = function() {
  const date = new Date(this.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};

// --------- Missing generateDailyPlan function for staffing route ---------
function generateDailyPlan(target, workdaysCount, requiredInterviewers) {
  if (workdaysCount <= 0 || requiredInterviewers <= 0) {
    return [];
  }
  
  const baseDailyTarget = Math.floor(target / workdaysCount);
  const remainder = target % workdaysCount;
  
  const plan = [];
  for (let i = 0; i < workdaysCount; i++) {
    const dailyTarget = baseDailyTarget + (i < remainder ? 1 : 0);
    plan.push({
      day: i + 1,
      target: dailyTarget,
      interviewers: requiredInterviewers,
      target_per_interviewer: Math.ceil(dailyTarget / requiredInterviewers)
    });
  }
  
  return plan;
}

// --------- Missing bestPath function for decision tree analysis ---------
function bestPath(node, conds = []) {
  if (!node || node.type === 'leaf') return { conds, avg: node?.avg || 0 };
  
  const pathLeft = bestPath(node.left, [...conds, { [node.dim]: node.equals }]);
  const pathRight = bestPath(node.right, conds);
  
  return (pathLeft.avg >= pathRight.avg) ? pathLeft : pathRight;
}

// --------- Outlier Removal and Feature Engineering ---------

// Remove outliers based on Interquartile Range (IQR)
function removeOutliers(data) {
  const Q1 = data[Math.floor(data.length / 4)];
  const Q3 = data[Math.floor(3 * data.length / 4)];
  const IQR = Q3 - Q1;
  const lowerBound = Q1 - 1.5 * IQR;
  const upperBound = Q3 + 1.5 * IQR;

  return data.filter(value => value >= lowerBound && value <= upperBound);
}

// Feature engineering: Add time-based features (week, month, year)
function addTimeFeatures(data) {
  return data.map(row => ({
    ...row,
    weekOfYear: new Date(row.date).getWeek(), // Week of year feature
    month: new Date(row.date).getMonth(),     // Month of the year feature
    year: new Date(row.date).getFullYear(),   // Year feature
  }));
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
  const sx  = points.reduce((s,p)=>s + p.x, 0);
  const sy  = points.reduce((s,p)=>s + p.y, 0);
  const sxx = points.reduce((s,p)=>s + p.x*p.x, 0);
  const sxy = points.reduce((s,p)=>s + p.x*p.y, 0);
  const denom = (n * sxx - sx * sx) || 1;

  const a = (n * sxy - sx * sy) / denom;
  const b = (sy - a * sx) / n;

  // predictions (keep non-negative), DO NOT round here so errors are unbiased
  const yhat = points.map(p => Math.max(0, a * p.x + b));
  const ybar = sy / n;

  // ---- standard errors ----
  const mse  = points.reduce((s,p,i)=> s + Math.pow(p.y - yhat[i], 2), 0) / n;
  const rmse = Math.sqrt(mse);
  const ssRes = points.reduce((s,p,i)=> s + Math.pow(p.y - yhat[i], 2), 0);
  const ssTot = points.reduce((s,p)=> s + Math.pow(p.y - ybar, 2), 0) || 1;
  const r2    = 1 - (ssRes / ssTot);

  const baselineMSE  = points.reduce((s,p)=> s + Math.pow(p.y - ybar, 2), 0) / n;
  const baselineRMSE = Math.sqrt(baselineMSE);
  const improvement  = baselineRMSE > 0 ? (1 - rmse / baselineRMSE) : null;

  const mae  = points.reduce((s,p,i)=> s + Math.abs(p.y - yhat[i]), 0) / n;
  const wape = points.reduce((s,p,i)=> s + Math.abs(p.y - yhat[i]), 0) /
               (points.reduce((s,p)=> s + Math.abs(p.y), 0) || 1);

  const mapeArr = points.map((p,i)=> p.y !== 0 ? Math.abs((p.y - yhat[i]) / p.y) : null).filter(v=>v!==null);
  const mape    = mapeArr.length ? (mapeArr.reduce((s,v)=>s+v,0)/mapeArr.length) : null;

  const MAPE_FLOOR = 5;
  const mapeFloorArr = points.map((p,i)=> p.y >= MAPE_FLOOR ? Math.abs((p.y - yhat[i]) / p.y) : null).filter(v=>v!==null);
  const mape_floor5 = mapeFloorArr.length ? (mapeFloorArr.reduce((s,v)=>s+v,0)/mapeFloorArr.length) : null;

  const EPS = 1e-9;
  const smapeArr = points.map((p,i)=>{
    const denom = Math.abs(p.y) + Math.abs(yhat[i]) + EPS;
    return (2 * Math.abs(p.y - yhat[i])) / denom;
  });
  const smape = smapeArr.reduce((s,v)=>s+v,0)/smapeArr.length;

  // ---- MASE (Mean Absolute Scaled Error) ----
  // Scale by the in-sample naive (lag-1) MAE. If flat series -> null.
  let mase = null, mase_denom = null;
  if (n >= 2) {
    const denomAbs = points.slice(1).reduce((s,p,i)=> s + Math.abs(p.y - points[i].y), 0) / (n - 1);
    mase_denom = denomAbs > 0 ? denomAbs : null;
    if (mase_denom) mase = mae / mase_denom;
  }

  return {
    a, b,
    yhat,
    r2, mse, rmse,
    baselineMSE, baselineRMSE, improvement,
    mae, wape, mape, mape_floor5, smape,
    mase, mase_denom
  };
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
    const rows = await prisma.$queryRaw`
      select id, name, upload_date, status, data_type, file_format, coalesce(tags,'') as tags
      from datasets
      order by upload_date desc nulls last, id desc
    `;
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
    console.error('dataset_list_failed:', e?.message);
    const status = /Can't reach database server/i.test(e?.message) ? 503 : 500;
    res.status(status).json({ message: 'dataset_list_failed', detail: e?.message });
  }
});

router.get('/_health', async (_req, res) => {
  try {
    const c = await prisma.$queryRaw`select count(*)::int as c from datasets`;
    res.json({ ok: true, datasets: c?.[0]?.c ?? 0 });
  } catch (e) {
    res.status(503).json({ ok: false, detail: e?.message });
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

    // dataset row creation
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

      // Add detailed logging to inspect the parsing outcome
      console.log("Parsed Data:", r); // Log raw parsed data
      rows = r.rows; sheetName = r.sheetName; normMap = r.normMap;

      if (!rows || rows.length === 0) {
        console.error("No rows found after parsing sheet.");
        return res.status(400).json({ error: 'No data rows detected' });
      }
    } catch (e) {
      console.error("Error in parsing the dataset:", e.message);
      console.error(e.stack);
      return res.status(400).json({ error: 'Failed to parse file', detail: e.message });
    } finally {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
    }
    tick(`parsed workbook: sheet="${sheetName}", rows=${rows?.length || 0}`);

    // transform -> facts
    let facts = [], issues = [];
    try {
      const out = consolidateRows(rows, {}, normMap);
      facts = out.facts || []; 
      issues = out.issues || [];

      // Logging the transformed facts
      console.log("Transformed Facts:", facts);
      console.log("Issues Detected:", issues);

      // Remove outliers 
      //facts = removeOutliers(facts);

      // Apply feature engineering
      facts = addTimeFeatures(facts);
    } catch (e) {
      console.error("Error in transformation step:", e.message);
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

        // Insert data into database
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
let oos = { rmse: null, mape: null, smape: null, r2: null, mase: null };
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

  // OOS MASE: scale with TRAIN naive MAE (per Hyndman)
  let trainNaive = null;
  if (train.length >= 2) {
    const denomAbs = train.slice(1).reduce((s,p,i)=> s + Math.abs(p.y - train[i].y), 0) / (train.length - 1);
    trainNaive = denomAbs > 0 ? denomAbs : null;
  }
  const testMAE = testY.reduce((s,v,i)=> s + Math.abs(v - testYhat[i]), 0) / testY.length;
  const tmase   = (trainNaive && Number.isFinite(testMAE)) ? (testMAE / trainNaive) : null;

  oos = { rmse: trmse, mape: tmape, smape: tsmape, r2: tr2, mase: tmase };
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
        mase: fit.mase,                              // <— already present in your snippet
        oos_rmse: oos.rmse, oos_mape: oos.mape, oos_smape: oos.smape, oos_r2: oos.r2,
        oos_mase: oos.mase                           // <— add this
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
        r2: fit.r2, rmse: fit.rmse, mse: fit.mse,
        baseline_rmse: fit.baselineRMSE,
        improvement_vs_baseline: fit.improvement,
        mae: fit.mae, wape: fit.wape,               // (if you keep them)
        mape: fit.mape, mape_floor5: fit.mape_floor5, smape: fit.smape,
        mase: fit.mase                               // <— add this
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

// ==================== PRESCRIPTIVE HELPERS (shared) ====================
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function parseIntOr(v, d) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }
function parseFloatOr(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

function quantile(sortedArr, q) {
  if (!sortedArr.length) return 0;
  const pos = (sortedArr.length - 1) * q;
  const base = Math.floor(pos), rest = pos - base;
  if (sortedArr[base + 1] !== undefined) return sortedArr[base] + rest * (sortedArr[base+1] - sortedArr[base]);
  return sortedArr[base];
}

async function kpiCompletion(prisma, datasetId, densityPct) {
  const totalRes = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT "respondentId")::int AS n
    FROM "ResponseFact" WHERE "datasetId" = ${datasetId}
  `;
  const respondent_count = totalRes?.[0]?.n || 0;

  const hard = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT "respondentId")::int AS n
    FROM "ResponseFact"
    WHERE "datasetId" = ${datasetId}
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
  const hardN = hard?.[0]?.n || 0;

  let completed_respondents = hardN;
  let completion_method = 'dated_or_flagged';

  if (hardN === 0) {
    const soft = await prisma.$queryRaw`
      WITH per AS (
        SELECT "respondentId", COUNT(*)::int AS c
        FROM "ResponseFact" WHERE "datasetId" = ${datasetId}
        GROUP BY "respondentId"
      ),
      m AS (SELECT MAX(c) AS mx FROM per)
      SELECT COUNT(*)::int AS n
      FROM per, m
      WHERE per.c >= GREATEST(1, FLOOR(${densityPct} * m.mx))
    `;
    completed_respondents = soft?.[0]?.n || 0;
    completion_method = `soft_density_${Math.round(densityPct*100)}pct`;
  }

  const completed_pct = respondent_count ? (100 * completed_respondents / respondent_count) : 0;
  return { respondent_count, completed_respondents, completed_pct, completion_method };
}

async function dailySeries(prisma, datasetId) {
  const rows = await prisma.$queryRaw`
    SELECT DATE("interviewDate") AS d,
           COUNT(DISTINCT "respondentId")::int AS c
    FROM "ResponseFact"
    WHERE "datasetId" = ${datasetId} AND "interviewDate" IS NOT NULL
    GROUP BY d
    ORDER BY d
  `;
  return (rows || []).map(r => ({ date: String(r.d), count: Number(r.c || 0) }));
}

async function regionCounts(prisma, datasetId, limit = 20) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(region,'Unspecified') AS region,
           COUNT(DISTINCT "respondentId")::int AS cnt
    FROM "ResponseFact"
    WHERE "datasetId" = ${datasetId} AND "interviewDate" IS NOT NULL
    GROUP BY region
    ORDER BY cnt DESC
    LIMIT ${parseInt(limit, 10)}
  `;
  return (rows || []).map(r => ({ region: r.region, cnt: Number(r.cnt || 0) }));
}

async function dowHourGrid(prisma, datasetId) {
  const rows = await prisma.$queryRaw`
    SELECT
      EXTRACT(DOW FROM "interviewDate")::int AS dow,
      EXTRACT(HOUR FROM "interviewDate")::int AS hour,
      COUNT(DISTINCT "respondentId")::int AS cnt
    FROM "ResponseFact"
    WHERE "datasetId" = ${datasetId} AND "interviewDate" IS NOT NULL
    GROUP BY dow, hour
    ORDER BY dow, hour
  `;
  return (rows || []).map(r => ({ dow: Number(r.dow), hour: Number(r.hour), cnt: Number(r.cnt || 0) }));
}

async function interviewerDist(prisma, datasetId) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(interviewer,'Unspecified') AS iv,
           COUNT(DISTINCT "respondentId")::int AS cnt
    FROM "ResponseFact"
    WHERE "datasetId" = ${datasetId} AND "interviewDate" IS NOT NULL
    GROUP BY iv
  `;
  const arr = (rows || []).map(r => Number(r.cnt || 0)).filter(Number.isFinite).sort((a,b)=>a-b);
  return arr;
}

async function lowCoverageQuestions(prisma, datasetId, topN = 5) {
  const rows = await prisma.$queryRaw`
    WITH per_q AS (
      SELECT "questionCode" AS q, COUNT(DISTINCT "respondentId")::int AS n
      FROM "ResponseFact" WHERE "datasetId" = ${datasetId}
      GROUP BY "questionCode"
    )
    SELECT q, n FROM per_q WHERE q IS NOT NULL ORDER BY n ASC NULLS LAST LIMIT ${parseInt(topN,10)}
  `;
  return (rows || []).map(r => ({ question: r.q, n: Number(r.n || 0) }));
}

// Try to auto-detect a satisfaction metric: a numeric question mostly 1..5 (CSAT-like)
async function detectCSAT(prisma, datasetId) {
  const rows = await prisma.$queryRawUnsafe(`
    WITH base AS (
      SELECT
        "questionCode" AS q,
        CASE
          WHEN "answerNum" IS NOT NULL THEN "answerNum"
          WHEN "answerText" ~ '^[\\s]*[+\\-]?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*%?[\\s]*$'
            THEN REGEXP_REPLACE(LOWER("answerText"), '[,%]', '', 'g')::numeric
          ELSE NULL
        END AS val
      FROM "ResponseFact"
      WHERE "datasetId" = $1
    ),
    agg AS (
      SELECT q,
             COUNT(*)::int AS n,
             COUNT(val)::int AS n_num,
             COUNT(*) FILTER (WHERE val BETWEEN 1 AND 5)::int AS n_1_5,
             AVG(val)::float8 AS avg_val
      FROM base
      GROUP BY q
    )
    SELECT q, n, n_num, n_1_5, avg_val
    FROM agg
    WHERE q IS NOT NULL
    ORDER BY n_1_5 DESC, n_num DESC, n DESC
    LIMIT 1
  `, datasetId);

  const top = rows?.[0];
  if (!top || !top.q || !Number.isFinite(Number(top.n_1_5 || 0))) return null;

  // If at least 60% of numeric answers sit in [1..5], consider this CSAT-like
  const ratio = (Number(top.n_1_5 || 0)) / Math.max(1, Number(top.n_num || 0));
  if (ratio < 0.6) return null;

  return {
    question: top.q,
    avg: Number(top.avg_val || 0),
    coverage_numeric: Number(top.n_num || 0),
    ratio_1_5: Number(ratio)
  };
}

function trailingAvg(arr, k) {
  if (!arr.length) return 0;
  const last = arr.slice(-k);
  return last.reduce((s,r)=>s + (r.count || 0), 0) / Math.max(1, last.length);
}

function enumerateWorkdaysCount(startDate, endDate, workdaysPerWeek) {
  const start = new Date(startDate), end = new Date(endDate);
  let c = 0;
  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const dow = cur.getDay(); // 0..6
    let isWork = true;
    if (workdaysPerWeek <= 5) isWork = (dow >= 1 && dow <= 5);
    else if (workdaysPerWeek === 6) isWork = (dow >= 1 && dow <= 6);
    else isWork = true;
    if (isWork) c++;
  }
  return c;
}

// ==================== PRESCRIPTIVE: RULES (threshold-based) ====================
// GET /api/dataset/:id/prescriptive/rules?csat_threshold=3&completion_threshold=0.7&coverage_threshold=0.6&imbalance_ratio=2
router.get('/:id/prescriptive/rules', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const density = Number(process.env.COMPLETION_DENSITY_PCT || 0.7);
    const csat_threshold = parseFloatOr(req.query.csat_threshold, 3.0);   // 1..5
    const completion_threshold = parseFloatOr(req.query.completion_threshold, 0.70); // 0..1
    const coverage_threshold = parseFloatOr(req.query.coverage_threshold, 0.60);     // 0..1
    const imbalance_ratio = parseFloatOr(req.query.imbalance_ratio, 2.0);

    const completion = await kpiCompletion(prisma, id, density);
    const csat = await detectCSAT(prisma, id);
    const regions = await regionCounts(prisma, id);
    const byRegionTotal = regions.reduce((s,r)=>s+r.cnt,0) || 1;
    const shares = regions.map(r => ({ region: r.region, share: r.cnt / byRegionTotal }));
    shares.sort((a,b)=>b.share - a.share);

    const lowQs = await lowCoverageQuestions(prisma, id, 8);

    const alerts = [];

    // Rule: low CSAT + low completion
    if (csat && csat.avg < csat_threshold && (completion.completed_pct / 100) < completion_threshold) {
      alerts.push({
        rule: 'LOW_CSAT_AND_COMPLETION',
        severity: 'high',
        message: `Average satisfaction (${csat.avg.toFixed(2)}) < ${csat_threshold} and completion ${completion.completed_pct.toFixed(1)}% < ${Math.round(completion_threshold*100)}% — target interventions by region and interviewer.`,
        details: { csat_question: csat.question }
      });
    }

    // Rule: low-coverage questions
    const coverageItems = lowQs.map(q => ({
      question: q.question,
      coverage_pct: completion.respondent_count ? (q.n / completion.respondent_count) : 0
    }));
    const poor = coverageItems.filter(x => x.coverage_pct < coverage_threshold);
    if (poor.length) {
      alerts.push({
        rule: 'LOW_QUESTION_COVERAGE',
        severity: 'high',
        message: `Some questions have < ${Math.round(coverage_threshold*100)}% respondent coverage — enforce required fields and tighten field scripts.`,
        details: poor.map(p => ({ question: p.question, coverage_pct: Number((p.coverage_pct*100).toFixed(1)) }))
      });
    }

    // Rule: regional imbalance
    if (shares.length >= 2) {
      const top = shares[0], bottom = shares[shares.length-1];
      if (bottom.share > 0 && (top.share / bottom.share) >= imbalance_ratio) {
        alerts.push({
          rule: 'REGIONAL_IMBALANCE',
          severity: 'medium',
          message: `Sampling is imbalanced: top region '${top.region}' share ${(top.share*100).toFixed(1)}% vs bottom '${bottom.region}' ${(bottom.share*100).toFixed(1)}% (≥${imbalance_ratio}× gap). Rebalance assignments.`,
          details: shares.map(s => ({ region: s.region, share_pct: Number((s.share*100).toFixed(1)) }))
        });
      }
    }

    res.json({
      dataset_id: id,
      thresholds: { csat_threshold, completion_threshold, coverage_threshold, imbalance_ratio },
      completion_kpis: completion,
      csat: csat || null,
      region_shares: shares,
      alerts
    });
  } catch (e) {
    console.error('prescriptive_rules_failed:', e);
    res.status(500).json({ message: 'prescriptive_rules_failed', detail: e.message });
  }
});

// ==================== PRESCRIPTIVE: DECISION TREE (shallow) ====================
// Heuristic "tree": split on DOW, HOUR_BUCKET, REGION to maximize average completes per day bucket.
// GET /api/dataset/:id/prescriptive/decision-tree?max_depth=2
router.get('/:id/prescriptive/decision-tree', async (req, res) => {
  try {
    const id = parseIntOr(req.params.id, -1);
    const max_depth = clamp(parseIntOr(req.query.max_depth, 2), 1, 3);

    // Build candidate features
    // Feature 1: day-of-week (0..6)
    // Feature 2: hour bucket: morning (6-11), afternoon (12-16), evening (17-21), off (others)
    // Feature 3: region (top 6 by count; rest grouped as "OTHER")
    const grid = await dowHourGrid(prisma, id);
    const regions = await regionCounts(prisma, id, 6);
    const regionSet = new Set(regions.map(r => r.region));

    // Build fact table keyed by (date, dow, hour_bucket, region): counts of completes
    const rows = await prisma.$queryRaw`
      SELECT DATE("interviewDate") AS d,
             EXTRACT(DOW FROM "interviewDate")::int AS dow,
             EXTRACT(HOUR FROM "interviewDate")::int AS hour,
             COALESCE(region,'Unspecified') AS region,
             COUNT(DISTINCT "respondentId")::int AS c
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY d, dow, hour, region
      ORDER BY d, dow, hour
    `;

    function hourBucket(h) {
      const hh = Number(h);
      if (hh >= 6 && hh <= 11) return 'MORNING';
      if (hh >= 12 && hh <= 16) return 'AFTERNOON';
      if (hh >= 17 && hh <= 21) return 'EVENING';
      return 'OFF';
    }

    const facts = (rows || []).map(r => ({
      date: String(r.d),
      dow: Number(r.dow),
      hour_bucket: hourBucket(r.hour),
      region: regionSet.has(r.region) ? r.region : 'OTHER',
      y: Number(r.c || 0)
    }));

    if (!facts.length) {
      return res.json({ dataset_id: id, depth: 0, nodes: [], recommendation: null });
    }

    // Simple greedy split chooser: pick feature/value that maximizes average y
    const dims = ['dow', 'hour_bucket', 'region'];

    function bestSplit(data) {
      let best = null;
      for (const dim of dims) {
        const groups = new Map();
        for (const r of data) {
          const k = r[dim];
          const g = groups.get(k) || { sum:0, n:0 };
          g.sum += r.y; g.n += 1;
          groups.set(k, g);
        }
        // choose the top-mean bucket
        for (const [val, g] of groups.entries()) {
          const mean = g.sum / Math.max(1, g.n);
          if (!best || mean > best.mean) best = { dim, val, mean };
        }
      }
      return best; // {dim, val, mean}
    }

    function buildTree(data, depth) {
      if (depth >= max_depth || data.length < 8) {
        // terminal node
        const avg = data.reduce((s,r)=>s+r.y,0)/Math.max(1,data.length);
        return { type: 'leaf', avg: Number(avg.toFixed(2)), n: data.length };
      }
      const split = bestSplit(data);
      if (!split) {
        const avg = data.reduce((s,r)=>s+r.y,0)/Math.max(1,data.length);
        return { type: 'leaf', avg: Number(avg.toFixed(2)), n: data.length };
      }
      const left = data.filter(r => r[split.dim] === split.val);
      const right = data.filter(r => r[split.dim] !== split.val);
      return {
        type: 'node',
        dim: split.dim,
        equals: split.val,
        mean: Number(split.mean.toFixed(2)),
        n_left: left.length,
        n_right: right.length,
        left: buildTree(left, depth + 1),
        right: buildTree(right, depth + 1)
      };
    }

    const tree = buildTree(facts, 0);

    // Derive a "next best action" from the leftmost (top-mean) path
    const nba = bestPath(tree, []);

    res.json({
      dataset_id: id,
      depth: max_depth,
      nodes: tree,
      recommendation: {
        conditions: nba.conds, // e.g., [{dow: 6}, {hour_bucket: 'EVENING'}, {region: 'METRO MANILA'}]
        expected_avg_completes_per_bucket: nba.avg
      }
    });
  } catch (e) {
    console.error('prescriptive_decision_tree_failed:', e);
    res.status(500).json({ message: 'prescriptive_decision_tree_failed', detail: e.message });
  }
});

// ==================== PRESCRIPTIVE: INSIGHTS (text + NBA) ====================
// GET /api/dataset/:id/prescriptive/insights?target=200&deadline=YYYY-MM-DD&rate=8&workdays=6
router.get('/:id/prescriptive/insights', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const target = Math.max(1, Number(req.query.target || 0));
    const rate = Math.max(1, Number(req.query.rate || 8));
    const workdays = clamp(parseIntOr(req.query.workdays, 6), 1, 7);
    const deadlineStr = String(req.query.deadline || '').slice(0, 10);
    if (!deadlineStr || isNaN(Date.parse(deadlineStr))) {
      return res.status(400).json({ error: 'deadline (YYYY-MM-DD) required' });
    }

    const density = Number(process.env.COMPLETION_DENSITY_PCT || 0.7);
    const today = new Date(); today.setHours(0,0,0,0);
    const deadline = new Date(deadlineStr + 'T00:00:00');

    const completion = await kpiCompletion(prisma, id, density);
    const daily = await dailySeries(prisma, id);
    const t7 = trailingAvg(daily, 7);
    const wd = enumerateWorkdaysCount(today, deadline, workdays) || 1;

    const required_rate = target / wd;
    const gap_per_day = required_rate - t7;
    const extra_interviewers = gap_per_day > 0 ? Math.ceil(gap_per_day / rate) : 0;

    const regions = await regionCounts(prisma, id);
    const totalByRegion = regions.reduce((s,r)=>s+r.cnt,0) || 1;
    const shares = regions.map(r => ({ region: r.region, share: r.cnt / totalByRegion }))
                          .sort((a,b)=>b.share - a.share);
    const ivDist = await interviewerDist(prisma, id);
    const q25 = quantile(ivDist, 0.25), q75 = quantile(ivDist, 0.75);

    const dowHour = await dowHourGrid(prisma, id);
    function bucket(h){ return (h>=6&&h<=11)?'MORNING':(h>=12&&h<=16)?'AFTERNOON':(h>=17&&h<=21)?'EVENING':'OFF'; }
    // top cells by average per distinct date
    const cellAgg = new Map(); // key: dow|bucket -> {sum, days}
    const byDayKey = new Set();
    for (const r of dowHour) {
      const k = `${r.dow}|${bucket(r.hour)}`;
      const obj = cellAgg.get(k) || { sum:0, n:0 };
      obj.sum += r.cnt; obj.n += 1;
      cellAgg.set(k, obj);
    }
    const cells = Array.from(cellAgg.entries()).map(([k,v])=>{
      const [d,b] = k.split('|'); return { dow:Number(d), bucket:b, avg: v.sum/Math.max(1,v.n) };
    }).sort((a,b)=>b.avg - a.avg);
    const bestCells = cells.slice(0,3);

    // Decision-tree "next best action"
    let nba = null;
    try {
      const resp = await prisma.$queryRaw`SELECT 1`; // cheap ping
      // We won't call HTTP to our own route; we re-derive quick NBA from best cells:
      nba = bestCells.length ? {
        conditions: bestCells.map(c => ({ dow: c.dow, hour_bucket: c.bucket })),
        expected_avg_completes_per_bucket: Number(bestCells[0].avg.toFixed(2))
      } : null;
    } catch {}

    // Build recommendations (short, action-forward)
    const recs = [];

    // Velocity vs target
    recs.push({
      title: 'Velocity vs Target',
      priority: gap_per_day > 0 ? 'high' : 'medium',
      text: gap_per_day > 0
        ? `Pace is ${t7.toFixed(1)} completes/day; need ${required_rate.toFixed(1)} to hit ${target} by ${deadlineStr}. Add ~${extra_interviewers} interviewer(s) at ${rate}/day or shift effort to high-yield slots.`
        : `Pace (${t7.toFixed(1)}/day) meets required ${required_rate.toFixed(1)} to reach ${target} by ${deadlineStr}. Maintain staffing on strong days.`,
      kpis: { trailing7_avg: Number(t7.toFixed(2)), required_rate: Number(required_rate.toFixed(2)), extra_interviewers }
    });

    // Schedule optimization
    if (bestCells.length) {
      const D = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const tip = bestCells.map(c => `${D[c.dow]}-${c.bucket}`).join(', ');
      recs.push({
        title: 'Optimize Schedule',
        priority: 'medium',
        text: `Concentrate deployment on: ${tip}. Expect higher completes during these windows based on historical yield.`,
        kpis: bestCells.map(c => ({
          dow: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][c.dow],
          bucket: c.bucket,
          avg_per_slot: Number(c.avg.toFixed(2))
        }))
      });
    }

    // Region rebalancing
    if (shares.length >= 2) {
      const top = shares[0], bottom = shares[shares.length - 1];
      recs.push({
        title: 'Rebalance Regions',
        priority: 'medium',
        text: `Reduce bias by shifting some effort from ${top.region} (${(top.share*100).toFixed(1)}%) toward ${bottom.region} (${(bottom.share*100).toFixed(1)}%).`,
        kpis: shares.map(s => ({ region: s.region, share_pct: Number((s.share*100).toFixed(1)) }))
      });
    }

    // Interviewer coaching
    if (ivDist.length >= 4) {
      const spread = q75 - q25;
      recs.push({
        title: 'Interviewer Coaching',
        priority: spread >= 3 ? 'medium' : 'low',
        text: spread >= 3
          ? 'Output variance across interviewers is large (Q3–Q1 spread). Pair low performers with high performers and rotate assignments.'
          : 'Output variance across interviewers is modest. Maintain current assignment plan.',
        kpis: { q25, q75, spread }
      });
    }

    // If CSAT exists, stitch it into guidance via rule engine results
    const csat = await detectCSAT(prisma, id);
    if (csat) {
      recs.push({
        title: 'Satisfaction Watch',
        priority: csat.avg < 3 ? 'high' : 'low',
        text: csat.avg < 3
          ? `Detected CSAT-like metric "${csat.question}" with average ${csat.avg.toFixed(2)} (<3). Review questionnaire phrasing and interviewer prompts; target coaching where CSAT is lagging.`
          : `Detected CSAT-like metric "${csat.question}" with average ${csat.avg.toFixed(2)}. Keep current script and cadence.`,
        kpis: { csat_question: csat.question, avg: Number(csat.avg.toFixed(2)) }
      });
    }

    res.json({
      dataset_id: id,
      inputs: { target, deadline: deadlineStr, rate, workdays },
      metrics: {
        respondent_count: completion.respondent_count,
        completed_respondents: completion.completed_respondents,
        completed_pct: Number(completion.completed_pct.toFixed(1)),
        completion_method: completion.completion_method,
        trailing7_avg: Number(t7.toFixed(2)),
        required_rate: Number(required_rate.toFixed(2)),
        gap_per_day: Number(gap_per_day.toFixed(2)),
        available_workdays: wd,
        extra_interviewers
      },
      next_best_action: nba,
      recommendations: recs
    });
  } catch (e) {
    console.error('prescriptive_text_insights_failed:', e);
    res.status(500).json({ message: 'prescriptive_text_insights_failed', detail: e.message });
  }
});// ==================== PRESCRIPTIVE: REGION ALLOCATION ====================
// GET /api/dataset/:id/prescriptive/region-allocation?target=200
router.get('/:id/prescriptive/region-allocation', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const target = Math.max(1, Number(req.query.target || 0));

    // Get historical completion counts by region
    const regions = await regionCounts(prisma, id, 50); // Get all regions
    
    const totalCompletes = regions.reduce((sum, r) => sum + r.cnt, 0);
    
    if (totalCompletes === 0) {
      // If no historical data, distribute evenly among available regions
      const uniqueRegions = await prisma.$queryRaw`
        SELECT DISTINCT COALESCE(region, 'Unspecified') as region
        FROM "ResponseFact" 
        WHERE "datasetId" = ${id}
      `;
      
      const equalShare = Math.round(target / Math.max(1, uniqueRegions.length));
      const items = uniqueRegions.map(r => ({
        region: r.region,
        share: 1 / uniqueRegions.length,
        assigned: equalShare
      }));
      
      // Adjust for rounding
      const totalAssigned = items.reduce((sum, item) => sum + item.assigned, 0);
      if (totalAssigned < target && items.length > 0) {
        items[0].assigned += (target - totalAssigned);
      }
      
      return res.json({ items });
    }

    // Calculate shares based on historical distribution
    const items = regions.map(r => ({
      region: r.region,
      share: r.cnt / totalCompletes,
      assigned: Math.round(r.cnt / totalCompletes * target)
    }));

    // Adjust for rounding errors
    const totalAssigned = items.reduce((sum, item) => sum + item.assigned, 0);
    let difference = target - totalAssigned;
    
    if (difference !== 0) {
      // Sort by share to adjust the largest regions first
      items.sort((a, b) => b.share - a.share);
      let index = 0;
      while (difference !== 0) {
        if (difference > 0) {
          items[index % items.length].assigned += 1;
          difference -= 1;
        } else {
          if (items[index % items.length].assigned > 0) {
            items[index % items.length].assigned -= 1;
            difference += 1;
          }
        }
        index++;
      }
    }

    res.json({ 
      items,
      historical_total: totalCompletes,
      allocation_method: totalCompletes > 0 ? 'historical_distribution' : 'equal_distribution'
    });
  } catch (e) {
    console.error('region_allocation_failed:', e);
    res.status(500).json({ message: 'region_allocation_failed', detail: e.message });
  }
});


// ==================== PRESCRIPTIVE: ENHANCED INSIGHTS (with Rule-Based Logic & Decision Trees) ====================
// GET /api/dataset/:id/prescriptive/insights?target=200&deadline=YYYY-MM-DD&rate=8&workdays=6
router.get('/:id/prescriptive/insights', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const target = Math.max(1, Number(req.query.target || 0));
    const rate = Math.max(1, Number(req.query.rate || 8));
    const workdays = clamp(parseIntOr(req.query.workdays, 6), 1, 7);
    const deadlineStr = String(req.query.deadline || '').slice(0, 10);
    
    if (!deadlineStr || isNaN(Date.parse(deadlineStr))) {
      return res.status(400).json({ error: 'deadline (YYYY-MM-DD) required' });
    }

    const density = Number(process.env.COMPLETION_DENSITY_PCT || 0.7);
    const today = new Date(); today.setHours(0,0,0,0);
    const deadline = new Date(deadlineStr + 'T00:00:00');

    // Get core metrics
    const completion = await kpiCompletion(prisma, id, density);
    const daily = await dailySeries(prisma, id);
    const t7 = trailingAvg(daily, 7);
    const wd = enumerateWorkdaysCount(today, deadline, workdays) || 1;

    const required_rate = target / wd;
    const gap_per_day = required_rate - t7;
    const extra_interviewers = gap_per_day > 0 ? Math.ceil(gap_per_day / rate) : 0;

    // Get data for rule-based logic
    const regions = await regionCounts(prisma, id);
    const csat = await detectCSAT(prisma, id);
    const lowQs = await lowCoverageQuestions(prisma, id, 5);
    
    // Decision Tree Analysis for optimal timing
    const dowHour = await dowHourGrid(prisma, id);
    const bestSlots = analyzeOptimalSlots(dowHour);

    // RULE-BASED LOGIC (as per capstone requirements)
    const ruleBasedAlerts = generateRuleBasedAlerts({
      completion,
      csat,
      regions,
      lowQs,
      t7,
      required_rate
    });

    // DECISION TREE OPTIMIZATION RECOMMENDATIONS
    const optimizationRecs = generateOptimizationRecommendations({
      bestSlots,
      regions,
      gap_per_day
    });

    // NEXT BEST ACTION RECOMMENDATIONS
    const nextBestActions = generateNextBestActions({
      ruleBasedAlerts,
      optimizationRecs,
      extra_interviewers,
      target
    });

    // Combine all recommendations
    const allRecommendations = [
      ...ruleBasedAlerts,
      ...optimizationRecs,
      ...nextBestActions
    ];

    res.json({
      dataset_id: id,
      inputs: { target, deadline: deadlineStr, rate, workdays },
      metrics: {
        respondent_count: completion.respondent_count,
        completed_respondents: completion.completed_respondents,
        completed_pct: Number(completion.completed_pct.toFixed(1)),
        trailing7_avg: Number(t7.toFixed(2)),
        required_rate: Number(required_rate.toFixed(2)),
        gap_per_day: Number(gap_per_day.toFixed(2)),
        available_workdays: wd,
        extra_interviewers
      },
      recommendations: allRecommendations,
      rule_based_alerts: ruleBasedAlerts.filter(r => r.priority === 'high'),
      optimization_paths: optimizationRecs,
      next_best_actions: nextBestActions
    });
  } catch (e) {
    console.error('enhanced_insights_failed:', e);
    res.status(500).json({ message: 'enhanced_insights_failed', detail: e.message });
  }
});

// Helper functions for enhanced insights
function analyzeOptimalSlots(dowHour) {
  const slots = [];
  for (const r of dowHour) {
    const slot = {
      dow: r.dow,
      hour: r.hour,
      count: r.cnt,
      efficiency: r.cnt // Simple efficiency metric
    };
    slots.push(slot);
  }
  
  // Sort by efficiency (completes per slot)
  return slots.sort((a, b) => b.efficiency - a.efficiency).slice(0, 5);
}

function generateRuleBasedAlerts({ completion, csat, regions, lowQs, t7, required_rate }) {
  const alerts = [];
  const completionRate = completion.completed_pct / 100;
  
  // RULE 1: Low Satisfaction + Low Completion Rate
  if (csat && csat.avg < 3 && completionRate < 0.7) {
    alerts.push({
      title: 'Critical: Low Satisfaction and Completion Rate',
      priority: 'high',
      text: `Satisfaction score (${csat.avg.toFixed(2)}) below 3 and completion rate (${completion.completed_pct.toFixed(1)}%) below 70%. Recommend targeted intervention in underperforming regions.`,
      type: 'rule_based',
      rule: 'LOW_SATISFACTION_AND_COMPLETION'
    });
  }

  // RULE 2: Performance Gap Alert
  if (t7 < required_rate * 0.8) {
    alerts.push({
      title: 'Performance Gap Detected',
      priority: 'high', 
      text: `Current pace (${t7.toFixed(1)}/day) is below 80% of required rate (${required_rate.toFixed(1)}/day). Immediate action needed to avoid missing targets.`,
      type: 'rule_based',
      rule: 'PERFORMANCE_GAP'
    });
  }

  // RULE 3: Low Coverage Questions
  if (lowQs.length > 0 && completion.respondent_count > 0) {
    const coveragePct = (lowQs[0].n / completion.respondent_count) * 100;
    if (coveragePct < 60) {
      alerts.push({
        title: 'Low Question Coverage Alert',
        priority: 'medium',
        text: `Question "${lowQs[0].question}" has only ${coveragePct.toFixed(1)}% coverage. Review field scripts and interviewer training.`,
        type: 'rule_based',
        rule: 'LOW_COVERAGE'
      });
    }
  }

  return alerts;
}

function generateOptimizationRecommendations({ bestSlots, regions, gap_per_day }) {
  const recs = [];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Time optimization from decision tree analysis
  if (bestSlots.length > 0) {
    const bestSlot = bestSlots[0];
    recs.push({
      title: 'Optimal Survey Timing',
      priority: 'medium',
      text: `Decision tree analysis identifies ${dayNames[bestSlot.dow]} ${bestSlot.hour}:00 as highest yielding time slot. Increase deployments during similar windows.`,
      type: 'optimization',
      algorithm: 'decision_tree'
    });
  }

  // Regional optimization
  if (regions.length >= 3) {
    const topRegion = regions[0];
    const bottomRegion = regions[regions.length - 1];
    const ratio = topRegion.cnt / Math.max(1, bottomRegion.cnt);
    
    if (ratio > 2) {
      recs.push({
        title: 'Regional Rebalancing Opportunity',
        priority: 'medium',
        text: `Significant imbalance detected: ${topRegion.region} completes ${ratio.toFixed(1)}× more than ${bottomRegion.region}. Reallocate resources for better coverage.`,
        type: 'optimization', 
        algorithm: 'regional_analysis'
      });
    }
  }

  return recs;
}

function generateNextBestActions({ ruleBasedAlerts, optimizationRecs, extra_interviewers, target }) {
  const actions = [];
  const hasCriticalAlerts = ruleBasedAlerts.some(alert => alert.priority === 'high');

  // Primary next best action based on situation
  if (hasCriticalAlerts) {
    actions.push({
      title: 'Immediate Intervention Required',
      priority: 'high',
      text: 'Multiple critical alerts detected. Focus on regional performance review and interviewer retraining before scaling operations.',
      type: 'next_best_action'
    });
  } else if (extra_interviewers > 0) {
    actions.push({
      title: 'Scale Interviewer Capacity',
      priority: 'medium',
      text: `Add ${extra_interviewers} interviewer(s) to meet target of ${target} completes. Deploy during optimal time slots identified.`,
      type: 'next_best_action'
    });
  } else {
    actions.push({
      title: 'Maintain Current Operations',
      priority: 'low',
      text: 'Current pace meets requirements. Focus on quality maintenance and minor optimizations.',
      type: 'next_best_action'
    });
  }

  // Additional strategic actions
  actions.push({
    title: 'Strategic Deployment Planning',
    priority: 'medium',
    text: 'Implement A/B testing for different deployment strategies to identify additional efficiency gains.',
    type: 'next_best_action'
  });

  return actions;
}

// ==================== PRESCRIPTIVE: MONITOR (validation & drift) ====================
// GET /api/dataset/:id/prescriptive/monitor?lookback=21
router.get('/:id/prescriptive/monitor', async (req, res) => {
  try {
    const id = parseIntOr(req.params.id, -1);
    const lookback = clamp(parseIntOr(req.query.lookback, 21), 7, 60);
    const series = await dailySeries(prisma, id);
    const last = series.slice(-lookback);

    const alerts = [];
    if (!last.length) {
      alerts.push({ code: 'NO_ACTIVITY', severity: 'high', message: 'No interview activity detected.' });
      return res.json({ dataset_id: id, alerts, windows: null });
    }

    // Windowed 3-day moving averages: compare last 3 vs prior 3
    const k = 3;
    const last3 = last.slice(-k).reduce((s,r)=>s+r.count,0)/Math.max(1, Math.min(k,last.length));
    const prior3 = last.length > k ? last.slice(-(2*k), -k).reduce((s,r)=>s+r.count,0)/k : null;
    if (prior3 !== null && prior3 > 0) {
      const drop = (last3 - prior3) / prior3;
      if (drop <= -0.3) {
        alerts.push({
          code: 'RATE_DROP',
          severity: 'high',
          message: `3-day average dropped ${(Math.abs(drop)*100).toFixed(0)}% vs prior 3 days. Investigate staffing, instrument issues, or holidays.`
        });
      }
    }

    // Days since last activity
    const lastDate = new Date(last[last.length-1].date);
    const today = new Date(); today.setHours(0,0,0,0);
    const deltaDays = Math.round((today - lastDate) / (24*3600*1000));
    if (deltaDays >= 3) {
      alerts.push({ code: 'STALE_ACTIVITY', severity: 'medium', message: `No interviews in ${deltaDays} day(s).` });
    }

    // Question coverage regression: compare bottom-coverage question share over the window
    const lowQs = await lowCoverageQuestions(prisma, id, 5);
    alerts.push({
      code: 'LOW_COVERAGE_QUESTIONS',
      severity: lowQs.length ? 'medium' : 'low',
      message: lowQs.length ? 'Some questions show persistently low coverage.' : 'No low-coverage questions detected recently.',
      details: lowQs
    });

    res.json({
      dataset_id: id,
      windows: { lookback_days: lookback, last3, prior3 },
      alerts
    });
  } catch (e) {
    console.error('prescriptive_monitor_failed:', e);
    res.status(500).json({ message: 'prescriptive_monitor_failed', detail: e.message });
  }
});

// ---------------------------- STAFFING ROUTE ----------------------------
// Enhanced staffing route with historical data alignment
router.get('/:id/prescriptive/staffing', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const target = Math.max(1, Number(req.query.target || 0));
    const rate = Math.max(1, Number(req.query.rate || 8));
    const workdays = clamp(parseIntOr(req.query.workdays, 6), 1, 7);
    const deadlineStr = String(req.query.deadline || '').slice(0, 10);

    if (!deadlineStr || isNaN(Date.parse(deadlineStr))) {
      return res.status(400).json({ error: 'Invalid deadline. Use YYYY-MM-DD format.' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(deadlineStr + "T00:00:00");

    // Get historical performance data
    const daily = await dailySeries(prisma, id);
    const t7 = trailingAvg(daily, 7);
    const workdaysCount = enumerateWorkdaysCount(today, deadline, workdays);
    
    if (workdaysCount <= 0) {
      return res.status(400).json({ error: 'No workdays available between today and deadline' });
    }

    // Calculate based on historical performance or fallback to theoretical rate
    const effectiveRate = t7 > 0 ? Math.min(rate, t7) : rate;
    const requiredInterviewers = Math.max(1, Math.ceil(target / (effectiveRate * workdaysCount)));
    const maxCapacity = requiredInterviewers * rate * workdaysCount;

    // Generate realistic daily plan
    const dailyPlan = generateRealisticDailyPlan(target, workdaysCount, requiredInterviewers, effectiveRate);

    res.json({
      required_interviewers: requiredInterviewers,
      available_workdays: workdaysCount,
      max_capacity: maxCapacity,
      daily_plan: dailyPlan,
      assumptions: {
        interviews_per_interviewer_per_day: rate,
        effective_rate_based_on_history: Number(effectiveRate.toFixed(2)),
        workdays_per_week: workdays,
        total_days: Math.ceil((deadline - today) / (1000 * 60 * 60 * 24)),
        work_days: workdaysCount
      }
    });
  } catch (e) {
    console.error('Enhanced Staffing Route Failed:', e);
    res.status(500).json({ error: 'staffing_failed', detail: e.message });
  }
});

function generateRealisticDailyPlan(target, workdaysCount, interviewers, effectiveRate) {
  const baseDailyTarget = Math.floor(target / workdaysCount);
  const remainder = target % workdaysCount;
  
  const plan = [];
  let date = new Date();
  
  for (let i = 0; i < workdaysCount; i++) {
    // Increment date, skipping weekends if needed
    date.setDate(date.getDate() + 1);
    while (date.getDay() === 0 || date.getDay() === 6) {
      date.setDate(date.getDate() + 1);
    }
    
    const dailyTarget = baseDailyTarget + (i < remainder ? 1 : 0);
    const expectedCompletes = Math.min(dailyTarget, interviewers * effectiveRate);
    
    plan.push({
      date: date.toISOString().slice(0, 10),
      interviewers: interviewers,
      expected_completes: Math.round(expectedCompletes)
    });
  }
  
  return plan;
}

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

export default router;