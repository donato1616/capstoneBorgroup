// server.js (ESM, Prisma, Express)
import dotenv from 'dotenv';
import express from 'express';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;

// ---- BigInt -> string so res.json won't crash on bigint columns ----
app.set('json replacer', (_, v) => (typeof v === 'bigint' ? v.toString() : v));

// ====== GLOBAL CORS HANDLER ======
// Must be first to handle all requests, including OPTIONS preflight
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200); // preflight
  next();
});

// ====== Middleware ======
app.use(express.json({ limit: '10mb' }));

// ====== Health ======
app.get('/health', (_req, res) => res.json({ ok: true }));

// ====== Helper: resolve dataset UUID ======
async function resolveDatasetUuid(idParam) {
  const idText = String(idParam ?? '').trim();

  // already looks like a UUID
  if (idText.includes('-') && idText.length >= 36) return idText;

  // try legacy numeric id
  const oldId = Number.parseInt(idText, 10);
  if (!Number.isFinite(oldId)) throw new Error('Invalid dataset id');

  const rows = await prisma.$queryRaw`
    select dataset_id
    from ops.dataset_map
    where old_dataset_id = ${oldId}
    limit 1
  `;
  if (!rows.length) throw new Error('Dataset mapping not found');
  return rows[0].dataset_id;
}

// ====== ROUTES ======

// 0) Analytics (used by DatasetAnalytics.jsx)
//    GET /api/analytics/:datasetId?region=&isComplete=&startDate=&endDate=
//    Response: { responses: [...] }
app.get('/api/analytics/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { region, isComplete, startDate, endDate } = req.query;

    const dsUuid = await resolveDatasetUuid(datasetId);

    // Pull rows; keep SQL simple, filter in JS (can move to SQL later)
    const rows = await prisma.$queryRaw`
      select clean_row_id, business_key, observed_at, region, surveyor, measures, src_json
      from dwh.clean_row
      where dataset_id = ${dsUuid}::uuid
    `;

    const toBool = (v) =>
      v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';

    const norm = (s) => String(s ?? '').trim().toLowerCase();

    let filtered = rows;

    if (region) {
      const wanted = norm(region);
      filtered = filtered.filter((r) => norm(r.region) === wanted);
    }

    if (typeof isComplete !== 'undefined') {
      const wantComplete = toBool(isComplete);
      filtered = filtered.filter((r) => toBool(r?.measures?.is_complete) === wantComplete);
    }

    if (startDate) {
      const sd = new Date(startDate);
      filtered = filtered.filter((r) => r.observed_at && new Date(r.observed_at) >= sd);
    }

    if (endDate) {
      const ed = new Date(endDate);
      filtered = filtered.filter((r) => r.observed_at && new Date(r.observed_at) <= ed);
    }

    const responses = filtered.map((r) => ({
      id: r.clean_row_id,
      businessKey: String(r.business_key ?? ''),
      region: r.region ?? null,
      isComplete: toBool(r?.measures?.is_complete),
      submittedAt: r.observed_at,
      surveyor: r.surveyor ?? null,
      durationSec: Number(r?.measures?.duration_sec ?? 0) || 0,
      answers: r.src_json ?? {},
    }));

    res.json({ responses }); // always 200 with array to avoid 404 spam in UI
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.json({ responses: [] });
  }
});

// 1) Datasets list (for dropdown)
app.get('/api/datasets', async (_req, res) => {
  try {
    const datasets = await prisma.$queryRaw`
      select
        d.dataset_id,
        d.name,
        d.uploaded_at,
        d.total_rows,
        d.status,
        coalesce(dm.data_type,'')   as data_type,
        coalesce(dm.file_format,'') as file_format,
        coalesce(dm.tags,'')        as tags,
        coalesce(iss.open_issues,0) as open_issues,
        m.old_dataset_id            as legacy_id
      from ops.dataset d
      left join ops.dataset_meta dm on dm.dataset_id = d.dataset_id
      left join (
        select dataset_id, count(*)::int as open_issues
        from staging.validation_issue
        where resolved_at is null
        group by dataset_id
      ) iss on iss.dataset_id = d.dataset_id
      left join ops.dataset_map m on m.dataset_id = d.dataset_id
      order by d.uploaded_at desc
    `;
    res.json(datasets);
  } catch (err) {
    console.error('Error fetching datasets:', err);
    res.status(500).json({ message: 'Error fetching datasets', detail: String(err.message || err) });
  }
});

// 2) Dataset rows (flagged | clean | all)
app.get('/api/datasets/:id/rows', async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.query.status || 'flagged').toLowerCase();
    const limit = Math.min(Number.parseInt(req.query.limit || '50', 10), 200);
    const offset = Number.parseInt(req.query.offset || '0', 10);

    const dsUuid = await resolveDatasetUuid(id);

    if (status === 'flagged') {
      const rows = await prisma.$queryRaw`
        select
          rr.raw_row_id, rr.row_idx, rr.data,
          json_agg(vi order by vi.issue_id) filter (where vi.issue_id is not null) as issues
        from staging.raw_row rr
        left join staging.validation_issue vi
          on vi.raw_row_id = rr.raw_row_id and vi.resolved_at is null
        where rr.dataset_id = ${dsUuid}::uuid
          and exists (
            select 1 from staging.validation_issue x
            where x.raw_row_id = rr.raw_row_id and x.resolved_at is null
          )
        group by rr.raw_row_id
        order by rr.row_idx
        limit ${limit} offset ${offset}
      `;
      return res.json(rows);
    }

    if (status === 'clean') {
      const rows = await prisma.$queryRaw`
        select clean_row_id, business_key, observed_at, region, surveyor, measures, src_json
        from dwh.clean_row
        where dataset_id = ${dsUuid}::uuid
        order by clean_row_id
        limit ${limit} offset ${offset}
      `;
      return res.json(rows);
    }

    const rows = await prisma.$queryRaw`
      select raw_row_id, row_idx, data
      from staging.raw_row
      where dataset_id = ${dsUuid}::uuid
      order by row_idx
      limit ${limit} offset ${offset}
    `;
    res.json(rows);
  } catch (err) {
    console.error('Error fetching rows:', err);
    res.status(500).json({ message: 'Error fetching rows', detail: String(err.message || err) });
  }
});

// 3) Apply admin fixes / audit / upsert
app.patch('/api/datasets/:id/rows/:rowId', async (req, res) => {
  try {
    const { id, rowId } = req.params;
    const numericRowId = Number.parseInt(rowId, 10);
    if (!Number.isFinite(numericRowId)) return res.status(400).json({ message: 'Invalid rowId' });

    const { fixes = {}, actor = 'admin', note = '' } = req.body || {};
    const dsUuid = await resolveDatasetUuid(id);

    const raw = await prisma.$queryRaw`
      select data
      from staging.raw_row
      where raw_row_id = ${numericRowId} and dataset_id = ${dsUuid}::uuid
      limit 1
    `;
    if (!raw.length) return res.status(404).json({ message: 'Row not found' });

    const original = raw[0].data || {};
    const updated = { ...original, ...fixes };

    // Resolve any open issues for this row
    await prisma.$executeRaw`
      update staging.validation_issue
      set resolved_at = now()
      where raw_row_id = ${numericRowId} and resolved_at is null
    `;

    // Per-field audit logs
    for (const [fieldKey, newValue] of Object.entries(fixes)) {
      const oldValue = Object.prototype.hasOwnProperty.call(original, fieldKey) ? original[fieldKey] : null;
      await prisma.$executeRaw`
        insert into ops.audit_log
          (dataset_id, raw_row_id, actor, action, field_name, old_value, new_value, note)
        values
          (${dsUuid}::uuid, ${numericRowId}, ${String(actor)}, 'EDIT', ${String(fieldKey)},
           ${String(oldValue)}, ${String(newValue)}, ${String(note)})
      `;
    }

    // Persist updated raw JSON (use string, not object, so PG can parse jsonb)
    const updatedJson = JSON.stringify(updated);
    await prisma.$executeRaw`
      update staging.raw_row
      set data = ${updatedJson}::jsonb
      where raw_row_id = ${numericRowId}
    `;

    // Upsert to clean table
    const business_key = String(updated.id ?? updated.response_id ?? numericRowId);
    const observed_at = updated.start_date || updated.date || null;
    const region = updated.region ?? null;
    const surveyor = String(updated.interviewer_id ?? updated.surveyor ?? '');
    const is_complete = (updated.is_complete === true || updated.is_complete === 'true') ? 1 : 0;
    const duration_sec = Number(updated.duration_sec ?? 0) || 0;

    await prisma.$executeRaw`
      delete from dwh.clean_row
      where dataset_id = ${dsUuid}::uuid and business_key = ${business_key}
    `;

    await prisma.$executeRaw`
      insert into dwh.clean_row
        (dataset_id, business_key, observed_at, region, surveyor, measures, src_json)
      values
        (
          ${dsUuid}::uuid,
          ${business_key},
          ${observed_at},
          ${region},
          ${surveyor},
          jsonb_build_object('duration_sec', ${duration_sec}, 'is_complete', ${is_complete}),
          ${updatedJson}::jsonb
        )
    `;

    // Row-level resolve note
    await prisma.$executeRaw`
      insert into ops.audit_log (dataset_id, raw_row_id, actor, action, note)
      values (${dsUuid}::uuid, ${numericRowId}, ${String(actor)}, 'RESOLVE', ${String(note)})
    `;

    res.json({ ok: true });
  } catch (err) {
    console.error('Error applying fix:', err);
    res.status(500).json({ message: 'Error applying fix', detail: String(err.message || err) });
  }
});

// --- route lister + 404 logger (diagnostic) ---
function listRoutes(app) {
  const out = [];
  app._router?.stack?.forEach((m) => {
    if (m.route && m.route.path) {
      const methods = Object.keys(m.route.methods).join(',').toUpperCase();
      out.push(`${methods.padEnd(6)}  ${m.route.path}`);
    }
  });
  return out;
}
app.get('/api/analytics/_debug/ping', (_req, res) => {
  res.json({ ok: true, note: 'analytics router is mounted' });
});
app.use((req, res) => {
  console.warn('404 ->', req.method, req.originalUrl);
  res.status(404).json({
    message: 'Not Found',
    method: req.method,
    path: req.originalUrl,
    routes: listRoutes(app),
  });
});

// ====== Start server ======
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log('Registered routes:\n' + listRoutes(app).join('\n'));
});
