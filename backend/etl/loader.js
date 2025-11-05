// backend/etl/loader.js (CommonJS)
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const { normalizeHeader } = require('./canonical');

/**
 * Load JSON mapping files from ./etl/mappings/*.json
 * Each mapping can optionally contain:
 *   - filePatterns: [ "clientA", "FSR", ".*_June2025\\.xlsx$" ]
 *   - sheetName: "Data", or sheetNamePattern: "^(data|table)$"
 *   - headerRowOffset: number  (shift detected row downwards)
 */
function loadMappings() {
  const dir = path.join(__dirname, 'mappings');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      return {};
    }
  });
}

export function chooseMapping(filename) {
  const maps = loadMappings();
  const fname = String(filename || '').toLowerCase();

  // Priority 1: regex-like filePatterns
  const direct = maps.find(m =>
    Array.isArray(m.filePatterns) &&
    m.filePatterns.some(p => {
      try {
        // Treat entries that look like regex as regex; otherwise use substring
        if (/^[/^].*[$/i]*$/.test(p)) return new RegExp(p.replace(/^\/|\/[a-z]*$/gi, ''), 'i').test(fname);
        return fname.includes(String(p).toLowerCase());
      } catch { return fname.includes(String(p).toLowerCase()); }
    })
  );
  if (direct) return direct;

  // Fallback: a mapping without patterns (global default)
  return maps.find(m => !m.filePatterns || m.filePatterns.length === 0) || {};
}

// ---------- header detection helpers ----------
/**
 * Score a row’s “header-likeness”.
 * We prefer rows with more short, texty tokens (not purely numeric).
 */
function headerScore(cells = []) {
  let score = 0;
  for (const v of cells) {
    const s = String(v ?? '').trim();
    if (!s) continue;
    if (s.length <= 60) score += 1;
    if (/[A-Za-z]/.test(s)) score += 1;          // has letters
    if (!/^\d+(\.\d+)?$/.test(s)) score += 1;    // not just a number
  }
  return score;
}

/** Pick the densest / best-scoring header row among the first 12 rows. */
function detectHeaderRow(sheetAOA) {
  const limit = Math.min(12, sheetAOA.length);
  let bestRow = 0, bestScore = -1;
  for (let r = 0; r < limit; r++) {
    const sc = headerScore(sheetAOA[r] || []);
    if (sc > bestScore) { bestScore = sc; bestRow = r; }
  }
  return bestRow;
}

/** Make sure headers are non-empty, and unique. */
function normalizeHeaders(headers) {
  const out = [];
  const seen = new Map();
  let blank = 0;

  for (let h of headers) {
    let s = String(h || '').trim();
    if (!s || /^unnamed[:\s]?/i.test(s)) s = `__EMPTY_${++blank}`;
    // Ensure uniqueness (Excel allows dupes)
    const key = s.toLowerCase();
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    if (n > 0) s = `${s}__${n + 1}`;
    out.push(s);
  }
  return out;
}

/** Remove columns that are entirely empty across rows. */
function dropAllEmptyColumns(headers, records) {
  const keep = headers.filter(h =>
    records.some(rec => {
      const v = rec[h];
      return !(v === null || v === undefined || (typeof v === 'string' && v.trim() === ''));
    })
  );
  return keep;
}

// ---------- helpers for sheet selection ----------
function nameBias(name) {
  const n = String(name || '');
  if (/^(responses?|response data)$/i.test(n)) return 90;
  if (/^(data|dataset|raw|dump)$/i.test(n)) return 80;
  if (/^sheet1$/i.test(n)) return 70;
  if (/sample|main/i.test(n)) return 60;
  return 0;
}

function nonEmptyScore(ws) {
  // count non-empty cells (quick proxy for real content)
  const ref = ws['!ref'];
  if (!ref) return 0;
  const range = xlsx.utils.decode_range(ref);
  let c = 0;
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[xlsx.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.v !== undefined && String(cell.v).trim() !== '') c++;
    }
  }
  return c;
}

// ---------- main reader ----------
function readBestSheet(buffer, filename, mapping = {}) {
  const wb = xlsx.read(buffer, { type: 'buffer', cellDates: true, cellNF: false, cellText: false });

  // 1) choose sheet
  let sheetName = wb.SheetNames[0];
  if (mapping.sheetName && wb.SheetNames.includes(mapping.sheetName)) {
    sheetName = mapping.sheetName;
  } else if (mapping.sheetNamePattern) {
    const re = new RegExp(mapping.sheetNamePattern, 'i');
    const hit = wb.SheetNames.find(n => re.test(n));
    if (hit) sheetName = hit;
  } else {
    // Prefer the sheet with highest (nameBias + non-empty density)
    const ranked = wb.SheetNames.map(n => {
      const ws = wb.Sheets[n];
      return { n, score: nameBias(n) + nonEmptyScore(ws) };
    }).sort((a,b) => b.score - a.score);
    sheetName = (ranked[0]?.n) || wb.SheetNames[0];
  }

  const ws = wb.Sheets[sheetName];
  const aoa = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true });

  // 2) detect header row (+ optional relative offset from mapping)
  let hdrRow = detectHeaderRow(aoa);
  if (Number.isFinite(mapping.headerRowOffset) && mapping.headerRowOffset > 0) {
    hdrRow = Math.min(hdrRow + mapping.headerRowOffset, aoa.length - 1);
  }

  // 3) build records
  const headersRaw = normalizeHeaders(aoa[hdrRow] || []);
  const records = [];
  for (let r = hdrRow + 1; r < aoa.length; r++) {
    const arr = aoa[r] || [];
    const obj = {};
    headersRaw.forEach((h, i) => { obj[h] = arr[i]; });
    // skip fully empty rows
    if (Object.values(obj).every(v => v === null || v === undefined || (typeof v === 'string' && v.trim() === ''))) continue;
    records.push(obj);
  }

  // 4) drop columns that are entirely empty
  const keep = dropAllEmptyColumns(headersRaw, records);

  // 5) rows with kept columns only
  const rows = records.map(rec => {
    const o = {};
    for (const k of keep) o[k] = rec[k];
    return o;
  });

  // 6) normalized header -> original header map (first occurrence wins)
  const normMap = {};
  keep.forEach(k => { const n = normalizeHeader(k); if (!normMap[n]) normMap[n] = k; });

  return { sheetName, rows, normMap, headers: keep };
}

module.exports = { chooseMapping, readBestSheet };