// backend/etl/loader.js (CommonJS)
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const { normalizeHeader } = require('./canonical');

// ----- mappings -----
function loadMappings() {
  const dir = path.join(__dirname, 'mappings');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function chooseMapping(filename) {
  const maps = loadMappings();
  const match = maps.find(m =>
    (m.filePatterns || []).some(p => filename.toLowerCase().includes(p.toLowerCase()))
  );
  return match || maps.find(m => (m.filePatterns || []).length === 0) || {};
}

// ----- helpers for robust header detection -----
function detectHeaderRow(sheetAOA) {
  const upTo = Math.min(10, sheetAOA.length);
  let bestRow = 0, bestCount = 0;
  for (let r = 0; r < upTo; r++) {
    const cnt = (sheetAOA[r] || []).filter(v => String(v ?? '').trim() !== '').length;
    if (cnt > bestCount) { bestCount = cnt; bestRow = r; }
  }
  return bestRow;
}

function fillBlankHeaders(headers) {
  const out = [];
  let n = 0;
  for (let h of headers) {
    let s = String(h || '').trim();
    if (!s || /^unnamed[:\s]?/i.test(s)) s = `__EMPTY_${++n}`;
    out.push(s);
  }
  return out;
}

// ----- main reader -----
function readBestSheet(buffer, filename, mapping = {}) {
  const wb = xlsx.read(buffer, { type: 'buffer', cellDates: true, cellNF: false, cellText: false });

  // pick first sheet that actually has any content; otherwise the first
  const sheetName =
    wb.SheetNames.find(n => {
      const s = wb.Sheets[n];
      const r = xlsx.utils.sheet_to_json(s, { header: 1, raw: true });
      return Array.isArray(r) && r.length && r.some(row => (row || []).some(v => v !== null && v !== undefined && String(v).trim() !== ''));
    }) || wb.SheetNames[0];

  const ws = wb.Sheets[sheetName];
  const aoa = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true });

  // header row = densest of first 10 rows (or mapping.headerRowOffset relative)
  let hdrRow = detectHeaderRow(aoa);
  if (Number.isFinite(mapping.headerRowOffset) && mapping.headerRowOffset > 0) {
    hdrRow = Math.min(hdrRow + mapping.headerRowOffset, aoa.length - 1);
  }

  const headersRaw = fillBlankHeaders(aoa[hdrRow] || []);
  const records = [];
  for (let r = hdrRow + 1; r < aoa.length; r++) {
    const arr = aoa[r] || [];
    const obj = {};
    headersRaw.forEach((h, i) => { obj[h] = arr[i]; });
    // skip all-empty rows
    if (Object.values(obj).every(v => v === null || v === undefined || String(v).trim?.() === '')) continue;
    records.push(obj);
  }

  // drop columns that are entirely empty across the kept records
  const keep = headersRaw.filter(h => records.some(rec => {
    const v = rec[h];
    return !(v === null || v === undefined || String(v).trim?.() === '');
  }));

  const rows = records.map(rec => {
    const o = {};
    for (const k of keep) o[k] = rec[k];
    return o;
  });

  // normalized header map (normalizeHeader -> original header)
  const normMap = {};
  keep.forEach(k => { normMap[normalizeHeader(k)] = k; });

  return { sheetName, rows, normMap, headers: keep };
}

module.exports = { chooseMapping, readBestSheet };