const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

/**
 * GET /api/kpi/total-responses
 * Adapts data/clean/metrics.json -> KPI payload
 * - value = rows_completed (completed sessions)
 * - delta = 0 (no prior period available in this file)
 * - series = single point using generated_at (so sparkline won’t crash)
 */
router.get('/total-responses', (req, res) => {
  try {
    const p = path.join(process.cwd(), 'data', 'clean', 'metrics.json');
    if (!fs.existsSync(p)) {
      return res.status(404).json({ error: 'metrics.json not found at data/clean/metrics.json' });
    }
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));

    const value = Number(raw?.rows_completed ?? 0);
    const when = String(raw?.generated_at ?? new Date().toISOString().slice(0,10));
    const payload = {
      kpi: {
        title: "Total Responses (Completed)",
        value,
        delta: 0,           // we can’t compute change from metrics.json alone
        freq: "ALL"         // lifetime aggregate
      },
      // put a single point so charts don’t explode; your card will hide sparkline if length<2
      series: [{ x: when.slice(0,10), y: value }],
      meta: {
        source: "data/clean/metrics.json",
        files_processed: raw?.files_processed ?? [],
        completion_rate_pct: raw?.completion_rate_pct ?? null,
        rows_total: raw?.rows_total ?? null,
        generated_at: raw?.generated_at ?? null
      }
    };

    res.setHeader('Cache-Control', 'public, max-age=5');
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read metrics.json', details: String(e) });
  }
});

module.exports = router;
