import dotenv from "dotenv";
import express from "express";
import cors from "cors";

// ✅ use the shared prisma instance
import prisma from "./lib/prisma.js";

// Import routes (ESM)
import auditRoute from "./routes/audit.js";
import datasetRoute from "./routes/dataset.js";
import userRoutes from "./routes/users.js";
import authRoutes from "./routes/auth.js";
import fieldRouter from "./api/field.js";

dotenv.config();

const app = express();

// ---- Config ----
const PORT = Number(process.env.PORT || 8080); // Use dynamic PORT (or default to 8080 for local dev)

// Use the environment variable or default to the production Railway frontend URL
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "https://capstoneborgroup-production.up.railway.app"; // Production frontend URL

// Allow-list dev origins and production origin
const allowedOrigins = new Set([
  FRONTEND_ORIGIN, // Railway frontend URL
  "http://localhost:5173", // Local dev (React's default)
  "http://127.0.0.1:5173", // Local dev (React's default)
  "http://localhost:4173", // Alternative local dev port
  "http://127.0.0.1:4173", // Alternative local dev port
]);

// ---- CORS ----
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // Allow same-origin/server-to-server requests
    if (allowedOrigins.has(origin)) return cb(null, true); // Allow if in allowedOrigins
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true, // Allow credentials like cookies to be sent
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204, // Success status code for pre-flight requests
};

app.use(cors(corsOptions));

// ---- Body parsing ----
app.use(express.json({ limit: "10mb" }));

// ---- Health Check ----
app.get("/health", (_req, res) => res.json({ ok: true }));

// Quick DB health
app.get("/health/db", async (_req, res) => {
  try {
    // cheap ping
    await prisma.$queryRaw`select 1 as ok`;
    res.json({ ok: true });
  } catch (err) {
    console.error("DB health fail:", err?.message);
    res.status(503).json({ ok: false, error: "db_unreachable", detail: err?.message });
  }
});

// ---- Routes ----
app.use("/api/audit", auditRoute);
app.use("/api/dataset", datasetRoute);
app.use("/api/field", fieldRouter);
app.use("/api/users", userRoutes);
app.use("/api", authRoutes);

// ====== Helper: resolve dataset UUID ======
async function resolveDatasetUuid(idParam) {
  const idText = String(idParam || "").trim();
  if (idText.includes("-") && idText.length >= 36) return idText;

  const oldId = parseInt(idText, 10);
  if (!Number.isFinite(oldId)) throw new Error("Invalid dataset id");

  const rows = await prisma.$queryRaw`
    select dataset_id from ops.dataset_map where old_dataset_id = ${oldId} limit 1
  `;
  if (!rows.length) throw new Error("Dataset mapping not found");
  return rows[0].dataset_id;
}

// ====== Legacy Routes (kept, now using shared prisma) ======
app.get("/api/datasets", async (_req, res) => {
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
    console.error("Error fetching datasets:", err);
    // If DB is unreachable, surface 503 so frontend can show a friendly banner
    const status = /Can't reach database server/i.test(err?.message) ? 503 : 500;
    res.status(status).json({ message: "Error fetching datasets", detail: err?.message });
  }
});

app.get('/api/datasets/:id/rows', async (req, res) => {
  try {
    const { id } = req.params;
    const status = (req.query.status || 'flagged').toLowerCase(); // ✅ fixed typo (was statusx)
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
    const status = /Can't reach database server/i.test(err?.message) ? 503 : 500;
    res.status(status).json({ message: 'Error fetching rows', detail: err?.message });
  }
});

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
    const status = /Can't reach database server/i.test(err?.message) ? 503 : 500;
    res.status(status).json({ message: 'Error applying fix', detail: err?.message });
  }
});

// ---- Start ----
(async () => {
  try {
    // Early connect so failures are obvious at boot
    await prisma.$connect();
  } catch (e) {
    console.error("Prisma connect failed:", e?.message);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`CORS allowed origins: ${Array.from(allowedOrigins).join(", ")}`);
  });
})();