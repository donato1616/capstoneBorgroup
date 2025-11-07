import xlsx from "xlsx";
import fs from "fs";
import path from "path";
import { normalizeHeader } from "./canonical.js";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Mimic __dirname for ES Modules
const __dirname = dirname(fileURLToPath(import.meta.url));

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

function chooseMapping(filename) {
  const maps = loadMappings();
  const fname = String(filename || '').toLowerCase();

  const direct = maps.find(m =>
    Array.isArray(m.filePatterns) &&
    m.filePatterns.some(p => {
      try {
        if (/^[/^].*[$/i]*$/.test(p)) return new RegExp(p.replace(/^\/|\/[a-z]*$/gi, ''), 'i').test(fname);
        return fname.includes(String(p).toLowerCase());
      } catch { return fname.includes(String(p).toLowerCase()); }
    })
  );
  if (direct) return direct;

  return maps.find(m => !m.filePatterns || m.filePatterns.length === 0) || {};
}

// ---------- Data Type Detection ----------
function detectDataType(sheetAOA, sheetName) {
  const name = String(sheetName || '').toLowerCase();
  
  // Check sheet name for clues - be more specific
  if (name.includes('quota') || name.includes('summary') || name.includes('total') || name.includes('alloc')) {
    return 'metadata';
  }
  if (name.includes('response') || name.includes('data') || name.includes('raw') || name.includes('main')) {
    return 'responses';
  }

  // Check content for clues - look more specifically for response patterns
  const sampleRows = sheetAOA.slice(0, 15); // Check more rows
  let respondentIdCount = 0;
  let quotaCount = 0;
  let hasQuestionData = false;
  
  for (const row of sampleRows) {
    const rowText = row.join(' ').toLowerCase();
    
    // Look for respondent ID patterns
    if (rowText.includes('sbjnum') || rowText.includes('respondent') || rowText.includes('resp_id')) {
      respondentIdCount++;
    }
    
    // Look for quota/total patterns
    if (rowText.includes('quota') || rowText.includes('total') || rowText.includes('summary') || rowText.includes('alloc')) {
      quotaCount++;
    }
    
    // Look for actual question data (Q1, Q2, etc.)
    if (row.some(cell => /^q\d+/i.test(String(cell)))) {
      hasQuestionData = true;
    }
  }

  // If it has more quota indicators than respondent indicators, it's metadata
  if (quotaCount > respondentIdCount && !hasQuestionData) {
    return 'metadata';
  }
  
  // Default to responses if we're not sure
  return 'responses';
}

// ---------- header detection helpers ----------
function headerScore(cells = []) {
  let score = 0;
  for (const v of cells) {
    const s = String(v ?? '').trim();
    if (!s) continue;
    if (s.length <= 60) score += 1;
    if (/[A-Za-z]/.test(s)) score += 1;
    if (!/^\d+(\.\d+)?$/.test(s)) score += 1;
  }
  return score;
}

function detectHeaderRow(sheetAOA) {
  const limit = Math.min(20, sheetAOA.length); // Increased limit for complex files
  let bestRow = 0, bestScore = -1;
  
  for (let r = 0; r < limit; r++) {
    const row = sheetAOA[r] || [];
    const sc = headerScore(row);
    
    // Bonus for rows that contain known respondent ID headers
    const rowText = row.join(' ').toLowerCase();
    if (rowText.includes('sbjnum') || rowText.includes('respondent') || rowText.includes('resp_id')) {
      if (sc > bestScore) { bestScore = sc + 10; bestRow = r; }
    } else if (sc > bestScore) { 
      bestScore = sc; bestRow = r; 
    }
  }
  return bestRow;
}

function normalizeHeaders(headers) {
  const out = [];
  const seen = new Map();
  let blank = 0;

  for (let h of headers) {
    let s = String(h || '').trim();
    if (!s || /^unnamed[:\s]?/i.test(s)) s = `__EMPTY_${++blank}`;
    const key = s.toLowerCase();
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    if (n > 0) s = `${s}__${n + 1}`;
    out.push(s);
  }
  return out;
}

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
  if (/^(responses?|response data|raw data|dataset|data)$/i.test(n)) return 90;
  if (/^(data|dataset|raw|dump)$/i.test(n)) return 80;
  if (/^sheet1$/i.test(n)) return 70;
  if (/sample|main/i.test(n)) return 60;
  if (/quota|summary|total/i.test(n)) return 10; // Lower priority for metadata sheets
  return 0;
}

function nonEmptyScore(ws) {
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
  console.log(`Starting to process file: ${filename}`);
  const wb = xlsx.read(buffer, { type: 'buffer', cellDates: true, cellNF: false, cellText: false });

  // 1) Choose the best sheet for response data
  let bestSheet = null;
  let bestScore = -1;
  
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    
    if (!aoa || aoa.length === 0) continue;
    
    const dataType = detectDataType(aoa, sheetName);
    const score = nameBias(sheetName) + nonEmptyScore(ws);
    
    // Prioritize response data sheets
    const adjustedScore = dataType === 'responses' ? score + 100 : score;
    
    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestSheet = { name: sheetName, ws, aoa, dataType };
    }
  }

  if (!bestSheet) {
    throw new Error('No valid sheet found in the file');
  }

  const { name: sheetName, ws, aoa, dataType } = bestSheet;
  console.log(`Selected sheet: ${sheetName} (data type: ${dataType})`);

  if (dataType === 'metadata') {
    console.log('Skipping metadata sheet - no response data to process');
    return { 
      sheetName, 
      rows: [], 
      normMap: {}, 
      headers: [], 
      totalRows: 0, 
      totalColumns: 0,
      dataType: 'metadata',
      skipped: true
    };
  }

  console.log(`Raw data has ${aoa.length} rows and ${aoa[0] ? aoa[0].length : 0} columns`);

  // 2) Detect header row
  let hdrRow = detectHeaderRow(aoa);
  console.log(`Detected header row at index: ${hdrRow}`);

  // Apply mapping offset if specified
  if (Number.isFinite(mapping.headerRowOffset) && mapping.headerRowOffset > 0) {
    hdrRow = Math.min(hdrRow + mapping.headerRowOffset, aoa.length - 1);
    console.log(`Applied header row offset: ${mapping.headerRowOffset}, new header row: ${hdrRow}`);
  }

  // 3) Build records
  const headersRaw = normalizeHeaders(aoa[hdrRow] || []);
  const records = [];
  
  console.log(`Processing up to ${aoa.length - hdrRow - 1} rows with ${headersRaw.length} columns...`);
  
  for (let r = hdrRow + 1; r < aoa.length; r++) {
    if (records.length >= 10000) { // Safety limit
      console.log('Reached maximum record limit (10,000)');
      break;
    }
    
    const arr = aoa[r] || [];
    const obj = {};
    headersRaw.forEach((h, i) => { 
      obj[h] = i < arr.length ? arr[i] : null; 
    });
    
    // Skip rows that look like metadata (contain "TOTAL", "QUOTA", etc.)
    const rowValues = Object.values(obj).join(' ').toLowerCase();
    if (rowValues.includes('total') || rowValues.includes('quota') || rowValues.includes('summary')) {
      continue;
    }
    
    // Skip fully empty rows
    if (Object.values(obj).every(v => v === null || v === undefined || (typeof v === 'string' && v.trim() === ''))) {
      continue;
    }
    
    records.push(obj);
  }

  console.log(`Successfully processed ${records.length} response records`);

  if (records.length === 0) {
    console.log('No valid response records found after filtering');
    return { 
      sheetName, 
      rows: [], 
      normMap: {}, 
      headers: [], 
      totalRows: 0, 
      totalColumns: 0,
      dataType: 'responses',
      skipped: true
    };
  }

  // 4) Create output
  const keep = dropAllEmptyColumns(headersRaw, records);
  const rows = records.map(rec => {
    const o = {};
    for (const k of keep) o[k] = rec[k];
    return o;
  });

  const normMap = {};
  keep.forEach(k => { 
    const n = normalizeHeader(k); 
    if (!normMap[n]) normMap[n] = k; 
  });

  return { 
    sheetName, 
    rows, 
    normMap, 
    headers: keep,
    totalRows: records.length,
    totalColumns: keep.length,
    dataType: 'responses'
  };
}

export { chooseMapping, readBestSheet };