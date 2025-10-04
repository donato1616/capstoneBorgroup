// src/routes/analytics.js
import { Router } from "express";

const router = Router();

// Example in-memory store (replace with your DB logic)
const MOCK = {
  "85210cd8-6aa3-4ed2-ad64-2796511268f2": [
    { id: "r1", region: "NCR", isComplete: true, submittedAt: "2025-09-25", answers: {...{} } },
    { id: "r2", region: "Region IV-A", isComplete: false, submittedAt: "2025-09-28", answers: {...{} } },
  ],
  "05f70914-93d0-4578-9407-5f6d4329f09e": [],
  "a56bd395-9853-4e70-af8d-8dbf464ca371": []
};

// GET /api/analytics/:datasetId?region=&isComplete=&startDate=&endDate=
router.get("/:datasetId", async (req, res) => {
  const { datasetId } = req.params;
  const { region, isComplete, startDate, endDate } = req.query;

  // If you want to *avoid* 404s in the UI, always return 200 with empty array:
  const base = MOCK[datasetId] ?? [];

  // Apply filters (mirror what the frontend sends)
  let rows = base;
  if (region) rows = rows.filter(r => (r.region || "").toLowerCase() === String(region).toLowerCase());
  if (typeof isComplete !== "undefined") {
    const flag = String(isComplete).toLowerCase() === "true";
    rows = rows.filter(r => Boolean(r.isComplete) === flag);
  }
  if (startDate) rows = rows.filter(r => new Date(r.submittedAt) >= new Date(startDate));
  if (endDate)   rows = rows.filter(r => new Date(r.submittedAt) <= new Date(endDate));

  // Expected response shape for DatasetAnalytics.jsx
  res.json({ responses: rows });
});

export default router;
