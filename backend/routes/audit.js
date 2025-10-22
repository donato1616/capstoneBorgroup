import express from "express";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseCsvSync(filePath) {
  const txt = fs.readFileSync(filePath, "utf8").trim();
  if (!txt) return [];
  const lines = txt.split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    // simple comma split - good for your current file format
    const cols = line.split(",").map((c) => c.trim());
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? null;
    });
    return obj;
  });
}

// GET /api/audit/facets
router.get("/audit/facets", (_req, res) => {
  res.json({ datasets: [{ dataset_id: "audit_log", name: "Audit Log (CSV)" }] });
});

// GET /api/dataset/:datasetId/audit
router.get("/dataset/:datasetId/audit", (req, res) => {
  try {
    const limit = Math.min(1000, Number(req.query.limit) || 50);
    const offset = Number(req.query.offset) || 0;
    const csvPath = path.resolve(__dirname, "../../data/clean/audit_log.csv");

    if (!fs.existsSync(csvPath)) return res.json({ items: [], total: 0 });

    const rows = parseCsvSync(csvPath);
    const items = rows.map((r) => ({
      audit_id: randomUUID(),
      created_at: r.timestamp,
      actor: r.actor ?? null,
      action: r.action,
      dataset_name: r.sheet ?? req.params.datasetId,
      sheet: r.sheet ?? null,
      file_name: r.file,
      field_name: null,
      old_value: null,
      new_value: null,
      note: r.rows ? `rows: ${r.rows}` : (r.note ?? null),
      // keep original csv row for debugging if needed
      payload: r,
    }));

    res.json({ items: items.slice(offset, offset + limit), total: items.length });
  } catch (err) {
    console.error("Audit route error:", err);
    res.status(500).json({ items: [], total: 0, error: err.message });
  }
});

export default router;