// backend/server.js (CommonJS, Prisma, Express)
require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const datasetRoute = require('./routes/dataset');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;

// ====== GLOBAL CORS HANDLER ======
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ====== Middleware ======
app.use(express.json({ limit: '10mb' }));

// ====== Health ======
app.get('/health', (_req, res) => res.json({ ok: true }));

// ====== New dataset routes (upload/summary/qdist/responses) ======
app.use('/api/dataset', datasetRoute);

// ====== Helper: resolve dataset UUID ======
async function resolveDatasetUuid(idParam) {
  const idText = String(idParam || '').trim();
  if (idText.includes('-') && idText.length >= 36) return idText;

  const oldId = parseInt(idText, 10);
  if (!Number.isFinite(oldId)) throw new Error('Invalid dataset id');

  const rows = await prisma.$queryRaw`
    select dataset_id from ops.dataset_map where old_dataset_id = ${oldId} limit 1
  `;
  if (!rows.length) throw new Error('Dataset mapping not found');
  return rows[0].dataset_id;
}

// ====== ROUTES ======

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
    res.status(500).json({ message: 'Error fetching datasets', detail: err.message });
  }
});

// 2) Dataset rows (flagged | clean | all)
app.get('/api/datasets/:id/rows', async (req, res) => {
  try {
    const { id } = req.params;
    const status = (req.query.status || 'flagged').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);

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
    res.status(500).json({ message: 'Error fetching rows', detail: err.message });
  }
});

// 3) Apply admin fixes / audit / upsert
app.patch('/api/datasets/:id/rows/:rowId', async (req, res) => {
  try {
    const { id, rowId } = req.params;
    const { fixes = {}, actor = 'admin', note = '' } = req.body || {};
    const dsUuid = await resolveDatasetUuid(id);

    const raw = await prisma.$queryRaw`
      select data from staging.raw_row
      where raw_row_id = ${Number(rowId)} and dataset_id = ${dsUuid}::uuid
      limit 1
    `;
    if (!raw.length) return res.status(404).json({ message: 'Row not found' });

    const original = raw[0].data;
    const updated = { ...original, ...fixes };

    await prisma.$executeRaw`
      update staging.validation_issue
      set resolved_at = now()
      where raw_row_id = ${Number(rowId)} and resolved_at is null
    `;

    for (const [field, newValue] of Object.entries(fixes)) {
      const oldValue = original[field] ?? null;
      await prisma.$executeRaw`
        insert into ops.audit_log (dataset_id, raw_row_id, actor, action, field_name, old_value, new_value, note)
        values (${dsUuid}::uuid, ${Number(rowId)}, ${actor}, 'EDIT', ${field},
                ${String(oldValue)}, ${String(newValue)}, ${note})
      `;
    }

    await prisma.$executeRaw`
      update staging.raw_row set data = ${updated}::jsonb
      where raw_row_id = ${Number(rowId)}
    `;

    const business_key = String(updated.id ?? updated.response_id ?? rowId);
    const observed_at = updated.start_date || updated.date || null;
    const region = updated.region ?? null;
    const surveyor = (updated.interviewer_id ?? updated.surveyor ?? '') + '';
    const is_complete = (updated.is_complete === true || updated.is_complete === 'true') ? 1 : 0;
    const duration_sec = Number(updated.duration_sec ?? 0) || 0;

    await prisma.$executeRaw`
      delete from dwh.clean_row where dataset_id = ${dsUuid}::uuid and business_key = ${business_key}
    `;

    await prisma.$executeRaw`
      insert into dwh.clean_row (dataset_id, business_key, observed_at, region, surveyor, measures, src_json)
      values (
        ${dsUuid}::uuid,
        ${business_key},
        ${observed_at},
        ${region},
        ${surveyor},
        jsonb_build_object('duration_sec', ${duration_sec}, 'is_complete', ${is_complete}),
        ${updated}::jsonb
      )
    `;

    await prisma.$executeRaw`
      insert into ops.audit_log (dataset_id, raw_row_id, actor, action, note)
      values (${dsUuid}::uuid, ${Number(rowId)}, ${actor}, 'RESOLVE', ${note})
    `;

    res.json({ ok: true });
  } catch (err) {
    console.error('Error applying fix:', err);
    res.status(500).json({ message: 'Error applying fix', detail: err.message });
  }
});

// ====== Start server ======
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
