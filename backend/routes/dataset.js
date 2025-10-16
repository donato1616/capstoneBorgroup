// backend/routes/dataset.js (ESM version)
import express from "express";
import multer from "multer";
import { PrismaClient } from "@prisma/client";

// Import ETL helpers
import { chooseMapping, readBestSheet } from "../etl/loader.js";
import { consolidateRows } from "../etl/transform.js";

const router = express.Router();
const prisma = new PrismaClient();

// ✅ Use memoryStorage so req.file.buffer is available
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ------------------------------------------------------------------
// GET /api/dataset
// ------------------------------------------------------------------
router.get("/", async (_req, res) => {
  try {
    const rows = await prisma.datasets.findMany({
      select: {
        id: true,
        name: true,
        upload_date: true,
        status: true,
        data_type: true,
        file_format: true,
        tags: true,
      },
      orderBy: { upload_date: "desc" },
    });

    const out = rows.map((r) => ({
      dataset_id: r.id,
      name: r.name,
      upload_date: r.upload_date,
      status: r.status,
      data_type: r.data_type,
      file_format: r.file_format,
      tags: r.tags || "",
    }));

    res.json(out);
  } catch (err) {
    console.error("Error fetching dataset list:", err);
    res.status(500).json({ message: "Error fetching dataset list", detail: err.message });
  }
});

// ------------------------------------------------------------------
// POST /api/dataset/upload (CSV/XLSX)
// ------------------------------------------------------------------
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    if (!req.file.buffer || !Buffer.isBuffer(req.file.buffer)) {
      return res.status(400).json({ error: "File buffer missing (multer memoryStorage not active)" });
    }

    const fname = req.file.originalname || "upload";
    const lower = fname.toLowerCase();
    const isCsv = lower.endsWith(".csv");
    const isXlsx = lower.endsWith(".xlsx") || lower.endsWith(".xls");
    if (!isCsv && !isXlsx) {
      return res.status(400).json({ error: "Only .csv or .xlsx/.xls allowed" });
    }

    // 1️⃣ Register dataset
    const ds = await prisma.datasets.create({
      data: {
        name: req.body?.name || fname,
        upload_date: new Date(),
        status: "Processed",
        data_type: req.body?.data_type || "survey responses",
        file_format: isCsv ? "CSV" : "Excel",
        tags: req.body?.tags || "",
      },
    });

    // 2️⃣ Read + normalize file
    const mapping = chooseMapping(fname);
    const { rows, sheetName, normMap } = readBestSheet(req.file.buffer, fname, mapping);

    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: "No data rows detected" });
    }

    // 3️⃣ Consolidate to facts
    const { facts, issues = [] } = consolidateRows(rows, {}, normMap);

    // 4️⃣ Bulk insert to ResponseFact
    if (facts.length > 0) {
      const chunkSize = 1000;
      for (let i = 0; i < facts.length; i += chunkSize) {
        const chunk = facts.slice(i, i + chunkSize);
        await prisma.responseFact.createMany({
          data: chunk.map((f) => ({
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
            cleanJson: f.cleanJson,
          })),
          skipDuplicates: true,
        });
      }
    }

    res.json({
      status: "ok",
      dataset_id: ds.id,
      sheet: sheetName,
      inserted_facts: facts.length,
      issues_count: issues.length,
      file_info: {
        name: fname,
        size_bytes: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error("❌ Upload/ETL failed:", err);
    res.status(500).json({ error: "Upload/ETL failed", detail: String(err.message || err) });
  }
});

// ------------------------------------------------------------------
// POST /api/dataset/upload-check (no DB writes)
// ------------------------------------------------------------------
router.post("/upload-check", upload.single("file"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "No file/No buffer" });
    }
    const fname = req.file.originalname || "upload";
    const mapping = chooseMapping(fname);
    const { rows, sheetName, normMap, headers } = readBestSheet(req.file.buffer, fname, mapping);
    const sample = rows.slice(0, 3);
    return res.json({
      ok: true,
      file: { name: fname, size: req.file.size, mimetype: req.file.mimetype },
      sheet: sheetName,
      headers,
      first_rows: sample,
    });
  } catch (e) {
    console.error("upload-check failed:", e);
    res.status(500).json({ error: "upload_check_failed", detail: e.message });
  }
});

console.log("[dataset.js] routes loaded at", new Date().toISOString());
export default router;
