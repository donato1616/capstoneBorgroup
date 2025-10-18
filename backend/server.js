// backend/server.js (ESM version)
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

import datasetRoute from "./routes/dataset.js";
import fieldRouter from "./routes/field.js";
app.use("/api/field", fieldRouter);

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// ---- Config ----
const PORT = Number(process.env.PORT || 5050);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

// Allow-list dev origins (add more if needed)
const allowedOrigins = new Set([
  FRONTEND_ORIGIN,
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

// ---- CORS ----
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // same-origin/server-to-server
    if (allowedOrigins.has(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));

// ---- Health Check ----
app.get("/health", (_req, res) => res.json({ ok: true }));

// ---- Routes ----
app.use("/api/dataset", datasetRoute);

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

// ====== Legacy Routes ======
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
    res.status(500).json({ message: "Error fetching datasets", detail: err.message });
  }
});

// ---- Start Server ----
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`CORS allowed origins: ${Array.from(allowedOrigins).join(", ")}`);
});
