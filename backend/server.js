// server.js (CommonJS, Prisma, Express)
// ====== Imports & setup ======
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = 5000;

// ====== CORS (dev) ======
app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
}));

// Log incoming requests and headers to verify CORS is set
app.use((req, res, next) => {
  console.log("Request headers:", req.headers);  // Log incoming request headers
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});


app.use(express.json({ limit: '10mb' }));

// ====== Helper: resolve dataset UUID from UUID or legacy integer id ======
async function resolveDatasetUuid(idParam) {
  const idText = String(idParam || '').trim();

  // UUID-like (contains dashes) → return as is
  if (idText.includes('-') && idText.length >= 36) return idText;

  // Legacy integer id → look up in ops.dataset_map
  const oldId = parseInt(idText, 10);
  if (!Number.isFinite(oldId)) throw new Error('Invalid dataset id');

  const rows = await prisma.$queryRaw`
    select dataset_id from ops.dataset_map where old_dataset_id = ${oldId} limit 1
  `;
  if (!rows.length) throw new Error('Dataset mapping not found');
  return rows[0].dataset_id;
}

// ====== ROUTES ======

// 1) Datasets list (for dropdown) — from ops.dataset, with badges
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
    res.status(500).json({ message: 'Error fetching datasets' });
  }
});

// 2) Audit Trail rows (flagged | clean | all)
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
    res.status(500).json({ message: 'Error fetching rows' });
  }
});

// 3) Apply admin fixes (resolve issues, update raw JSON, upsert into clean, audit)
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
    const updated  = { ...original, ...fixes };

    // Mark ALL open issues for this row as resolved (simple & robust)
    await prisma.$executeRaw`
      update staging.validation_issue
      set resolved_at = now()
      where raw_row_id = ${Number(rowId)}
        and resolved_at is null
    `;

    // Audit per field changed
    for (const [field, newValue] of Object.entries(fixes)) {
      const oldValue = original[field] ?? null;
      await prisma.$executeRaw`
        insert into ops.audit_log (dataset_id, raw_row_id, actor, action, field_name, old_value, new_value, note)
        values (${dsUuid}::uuid, ${Number(rowId)}, ${actor}, 'EDIT', ${field},
                ${String(oldValue)}, ${String(newValue)}, ${note})
      `;
    }

    // Update raw JSON
    await prisma.$executeRaw`
      update staging.raw_row set data = ${updated}::jsonb
      where raw_row_id = ${Number(rowId)}
    `;

    // Normalize → upsert into dwh.clean_row (delete+insert by business_key to avoid dupes)
    const business_key = String(updated.id ?? updated.response_id ?? rowId);
    const observed_at  = updated.start_date || updated.date || null;
    const region       = updated.region ?? null;
    const surveyor     = (updated.interviewer_id ?? updated.surveyor ?? '') + '';
    const is_complete  = (updated.is_complete === true || updated.is_complete === 'true') ? 1 : 0;
    const duration_sec = Number(updated.duration_sec ?? 0) || 0;

    await prisma.$executeRaw`
      delete from dwh.clean_row
      where dataset_id = ${dsUuid}::uuid and business_key = ${business_key}
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

    // Final resolve note (optional)
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

// 4) Analytics snapshots (descriptive/predictive/prescriptive)
app.get('/api/datasets/:id/analytics', async (req, res) => {
  try {
    const dsUuid = await resolveDatasetUuid(req.params.id);
    const [desc, pred, presc] = await Promise.all([
      prisma.$queryRaw`select kpis, computed_at from analytics.descriptive_snapshot where dataset_id = ${dsUuid}::uuid`,
      prisma.$queryRaw`select model_summary, forecasts, computed_at from analytics.predictive_snapshot where dataset_id = ${dsUuid}::uuid`,
      prisma.$queryRaw`select recommendations, computed_at from analytics.prescriptive_snapshot where dataset_id = ${dsUuid}::uuid`
    ]);

    res.json({
      descriptive: desc.length ? desc[0] : null,
      predictive:  pred.length ? pred[0] : null,
      prescriptive:presc.length ? presc[0] : null
    });
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ message: 'Error fetching analytics' });
  }
});

// 5) Recompute descriptive analytics (button-friendly)
app.post('/api/datasets/:id/analytics/recompute', async (req, res) => {
  try {
    const dsUuid = await resolveDatasetUuid(req.params.id);
    await prisma.$executeRaw`
      with base as (
        select count(*)::int as rows_cnt from dwh.clean_row where dataset_id = ${dsUuid}::uuid
      ),
      tr as (
        select coalesce(jsonb_agg(x order by (x->>'cnt')::int desc), '[]'::jsonb) as regions_json
        from (
          select jsonb_build_object('region', region, 'cnt', count(*)) as x
          from dwh.clean_row
          where dataset_id = ${dsUuid}::uuid
          group by region
        ) s
      )
      insert into analytics.descriptive_snapshot (dataset_id, kpis)
      select ${dsUuid}::uuid, jsonb_build_object('rows', b.rows_cnt, 'top_regions', tr.regions_json)
      from base b cross join tr
      on conflict (dataset_id) do update set kpis = excluded.kpis, computed_at = now()
    `;
    res.json({ ok: true });
  } catch (err) {
    console.error('Error recomputing analytics:', err);
    res.status(500).json({ message: 'Error recomputing analytics' });
  }
});

// (Optional) Keep your original analytics route for compatibility under /api/legacy/analytics/:datasetId
app.get('/api/legacy/analytics/:datasetId', async (req, res) => {
  const datasetId = parseInt(req.params.datasetId);
  const { region, isComplete, startDate, endDate } = req.query;

  try {
    const dataset = await prisma.datasets.findUnique({
      where: { id: datasetId },
      include: {
        responses: {
          where: {
            AND: [
              region ? { region } : {},
              isComplete !== undefined ? { isComplete: isComplete === 'true' } : {},
              startDate ? { startDate: { gte: new Date(startDate) } } : {},
              endDate ? { startDate: { lte: new Date(endDate) } } : {},
            ]
          },
          include: { study: true, interviewer: true }
        }
      }
    });

    if (!dataset) return res.status(404).json({ message: 'Dataset not found' });

    const sortedResponses = (dataset.responses || []).sort((a, b) => {
      if (a.startDate < b.startDate) return -1;
      if (a.startDate > b.startDate) return 1;
      return (a.startHour || 0) - (b.startHour || 0);
    });

    res.json({
      dataset: {
        id: dataset.id,
        name: dataset.name,
        uploadDate: dataset.uploadDate,
        dataType: dataset.dataType
      },
      responses: sortedResponses
    });
  } catch (err) {
    console.error('Error fetching legacy analytics:', err);
    res.status(500).json({ message: 'Error fetching legacy analytics' });
  }
});

// ====== Start server ======
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
