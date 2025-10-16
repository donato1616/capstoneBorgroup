// backend/etl/loader.js (CommonJS)
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const { normalizeHeader } = require('./canonical');

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

function readBestSheet(buffer, filename, mapping = {}) {
  const wb = xlsx.read(buffer, { type: 'buffer' });

  const preferred = mapping.sheetPreference || [];
  let sheetName =
    wb.SheetNames.find(n => preferred.includes(n)) ||
    // prefer sheets named dump/main sample/data when no explicit preference
    wb.SheetNames.sort((a, b) => {
      const aw = /dump|main sample|data/i.test(a) ? 1 : 0;
      const bw = /dump|main sample|data/i.test(b) ? 1 : 0;
      return bw - aw;
    })[0];

  const ws = wb.Sheets[sheetName];
  let rows = xlsx.utils.sheet_to_json(ws, { defval: '', raw: false });

  const headerOffset = mapping.headerRowOffset || 0;
  if (headerOffset > 0) rows = rows.slice(headerOffset);

  // drop fully blank "Unnamed:*" columns
  const keys = Object.keys(rows[0] || {});
  const keep = keys.filter(k => {
    if (/^Unnamed/i.test(k)) {
      const anyVal = rows.some(r => r[k] !== '' && r[k] !== null);
      return anyVal;
    }
    return true;
  });

  rows = rows.map(r => {
    const o = {};
    for (const k of keep) o[k] = r[k];
    return o;
  });

  // normalized header map: normalized -> original
  const normMap = {};
  keep.forEach(k => (normMap[normalizeHeader(k)] = k));

  return { sheetName, rows, normMap, headers: keep };
}

module.exports = { chooseMapping, readBestSheet };
