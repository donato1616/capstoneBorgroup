// backend/etl/transform.js
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const crypto = require('crypto');
const { CANON, normalizeHeader, isQuestionCol: isQuestionColHeuristic } = require('./canonical');

dayjs.extend(customParseFormat);

// meta/non-question fields to exclude from pivot (normalized header names)
const META_HEADERS = new Set([
  'respondent_serial','respondentid','respondent_id','resp_id','sbjnum','uuid','id',
  'datacollection_finishtime','datacollection_starttime','finishtime','starttime',
  'interviewdate','date','timestamp','submissiondate','survey_date','start_date','end_date',
  'upload',
  'region','area','territory','zone','cluster','state','province','district',
  'city','municipality','barangay','city_municipality',
  'srvyr','interviewer','fieldworker','interviewername','interviewer_id','recruiter',
  'mode','channel','modeofinterview','interview_mode',
  'latitude','longitude','gps_lat','gps_lng','gps_latitude','gps_longitude',
  'duration','duration_sec','is_complete','status',
  'remarks','comment','comments','note','notes'
]);

// ---------- helpers ----------
function pick(row, candidates, normMap) {
  if (!candidates) return undefined;
  for (const c of candidates) {
    const n = normalizeHeader(c);
    const rawKey = normMap[n] || c;
    const v = row[rawKey];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

function excelSerialToDate(num) {
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  if (n < 59 || n > 100000) return null;
  const base = Date.UTC(1899, 11, 30);
  return new Date(base + n * 86400000);
}

// robust date parser for strings, numbers, and Excel dumps
function parseDateStrict(v) {
  if (v === null || v === undefined || v === '') return null;

  // numeric serial or numeric string
  if (typeof v === 'number' || (typeof v === 'string' && /^[0-9.]+$/.test(v.trim()))) {
    const d = excelSerialToDate(v);
    if (d) return d;
  }

  // broad set of formats (short month + full month + times)
  const trials = [
    // ISO-ish & numeric
    'YYYY-MM-DD', 'YYYY/MM/DD',
    'MM/DD/YYYY','M/D/YYYY','DD/MM/YYYY','D/M/YYYY',
    'YYYY-MM-DD HH:mm:ss','MM/DD/YYYY HH:mm','DD/MM/YYYY HH:mm',

    // short month
    'D MMM YYYY','DD-MMM-YYYY','YYYY-MMM-DD','D MMM YYYY hA','D-MMM-YYYY hA',

    // FULL month names
    'D MMMM YYYY','D MMMM YYYY hA','D MMMM YYYY HH:mm',
    'MMMM D, YYYY','MMMM D, YYYY hA','MMMM D, YYYY HH:mm',
    'MMMM D YYYY','MMMM D YYYY hA','MMMM D YYYY HH:mm',

    // compact tokens like 23June2025 (no spaces)
    'DDMMMMYYYY','DMMMMYYYY'
  ];

  const s = String(v).replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim(); // normalize
  for (const f of trials) {
    const d = dayjs(s, f, true);
    if (d.isValid()) return d.toDate();
  }

  // loose parse last
  const d = dayjs(s);
  return d.isValid() ? d.toDate() : null;
}

// parse date tokens hiding inside free-text like “062725 - …”, “6/27/25”, “23June2025”, “June 23, 2025 7PM”
function parseDateFromFreeText(text) {
  if (!text) return null;
  const s = String(text);

  // 6-digit token -> MMDDYY
  const m6 = s.match(/\b(\d{6})\b/);
  if (m6) {
    const t = m6[1];
    const mm = Number(t.slice(0,2));
    const dd = Number(t.slice(2,4));
    let yy = Number(t.slice(4,6));
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      yy = yy + (yy >= 70 ? 1900 : 2000);
      return new Date(yy, mm - 1, dd);
    }
  }

  // 6/27/25 or 27-06-2025
  const mSep = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?)?\b/i);
  if (mSep) {
    let a = Number(mSep[1]), b = Number(mSep[2]), c = Number(mSep[3]);
    const hh = mSep[4] ? Number(mSep[4]) : 0;
    const mi = mSep[5] ? Number(mSep[5]) : 0;
    const ap = mSep[6];
    const yyyy = c < 100 ? c + 2000 : c;
    let mm = a, dd = b;
    if (a > 12 && b <= 12) { mm = b; dd = a; }
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      let H = hh;
      if (ap) {
        const up = ap.toUpperCase();
        if (up === 'PM' && H < 12) H += 12;
        if (up === 'AM' && H === 12) H = 0;
      }
      return new Date(yyyy, mm - 1, dd, H, mi);
    }
  }

  // e.g., 23June2025 or June 23, 2025 7PM
  const mWord = s.match(/\b([A-Za-z]+)\s*(\d{1,2}),?\s*(\d{2,4})(?:\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?)?\b/);
  const mWord2 = s.match(/\b(\d{1,2})\s*([A-Za-z]+)\s*(\d{2,4})(?:\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?)?\b/);
  const monthNum = (name) => {
    const m = name.toLowerCase();
    const names = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const idx = names.findIndex(n => n.startsWith(m));
    return idx >= 0 ? idx + 1 : null;
  };
  const build = (mmName, ddStr, yyStr, hhStr, miStr, ap) => {
    const mm = monthNum(mmName);
    const dd = Number(ddStr);
    let yyyy = Number(yyStr); if (yyyy < 100) yyyy += 2000;
    if (!mm || dd < 1 || dd > 31) return null;
    let H = hhStr ? Number(hhStr) : 0;
    const M = miStr ? Number(miStr) : 0;
    if (ap) {
      const up = ap.toUpperCase();
      if (up === 'PM' && H < 12) H += 12;
      if (up === 'AM' && H === 12) H = 0;
    }
    return new Date(yyyy, mm - 1, dd, H, M);
  };
  if (mWord) return build(mWord[1], mWord[2], mWord[3], mWord[4], mWord[5], mWord[6]);
  if (mWord2) return build(mWord2[2], mWord2[1], mWord2[3], mWord2[4], mWord2[5], mWord2[6]);

  return null;
}

// scan any string cell for a date
function findAnyDateInRow(row) {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v == null) continue;
    const direct = parseDateStrict(v);
    if (direct) return direct;
    if (typeof v === 'string') {
      const t = parseDateFromFreeText(v);
      if (t) return t;
    }
  }
  return null;
}

function parseNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

// broadened question detector: heuristic OR allow non-meta columns
function isQuestionCol(headerNorm) {
  if (META_HEADERS.has(headerNorm)) return false;
  if (isQuestionColHeuristic(headerNorm)) return true;
  if (/(score|rating|rank|value|count|amount|index|total|pct|percent)/i.test(headerNorm)) return true;
  return true; // permissive for ragged spreadsheets
}

function syntheticId(row, i) {
  const h = crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex').slice(0, 10);
  return `resp_${i + 1}_${h}`;
}

// ---------- main ----------
function consolidateRows(rows, mapping = {}, normMap = {}) {
  const outFacts = [];
  const issues = [];
  const canon = { ...CANON, ...(mapping.canonical || {}) };

  if (!rows || !rows.length) return { facts: outFacts, issues };

  const headers = Object.keys(rows[0] || {});
  const headerNorms = headers.map(h => ({ norm: normalizeHeader(h), orig: h }));

  // detect columns that are completely blank
  const nonBlankColumns = new Set();
  for (const { norm, orig } of headerNorms) {
    const any = rows.some(r => r[orig] !== '' && r[orig] !== null && r[orig] !== undefined);
    if (any) nonBlankColumns.add(norm);
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    // identifiers / attributes
    const respondentIdRaw =
      pick(r, canon.respondentId, normMap) || r['Rno'] || r['RNO'] || r['rno'];
    let interviewDate = parseDateStrict(pick(r, canon.interviewDate, normMap));
    const region = pick(r, canon.region, normMap) || r['Area'] || r['area'];
    const city = pick(r, canon.city, normMap);
    const interviewer = pick(r, canon.interviewer, normMap) || r['Recruiter'] || r['recruiter'];
    const channel = pick(r, canon.channel, normMap);

    // fallback: columns that *look* like date/time
    if (!interviewDate) {
      for (const { norm, orig } of headerNorms) {
        if (!/(date|time|visit|fsr|schedule)/i.test(norm)) continue;
        const d = parseDateStrict(r[orig]) || parseDateFromFreeText(r[orig]);
        if (d) { interviewDate = d; break; }
      }
    }

    // fallback: free-text anywhere (e.g., Remarks)
    if (!interviewDate) {
      const fromRemarks = parseDateFromFreeText(
        pick(r, ['remarks','comment','comments','note','notes','status'], normMap)
      );
      interviewDate = fromRemarks || findAnyDateInRow(r);
    }

    const respondentId = respondentIdRaw ? String(respondentIdRaw).trim() : syntheticId(r, i);
    if (!respondentIdRaw) issues.push({ row: i, type: 'synthetic_respondent_id' });

    const cleanRow = {
      respondentId,
      interviewDate: interviewDate || null,
      region: region ? String(region).trim() : null,
      city: city ? String(city).trim() : null,
      interviewer: interviewer ? String(interviewer).trim() : null,
      channel: channel ? String(channel).trim() : null
    };

    let pushed = 0;

    // pivot to long
    for (const { norm, orig } of headerNorms) {
      if (!nonBlankColumns.has(norm)) continue;
      if (!isQuestionCol(norm)) continue;

      const rawVal = r[orig];
      const textVal = (rawVal === '' || rawVal === undefined || rawVal === null) ? null : String(rawVal);
      const numVal = parseNum(rawVal);

      if (textVal === null && numVal === null) continue;

      outFacts.push({
        respondentId: cleanRow.respondentId,
        interviewDate: cleanRow.interviewDate,
        region: cleanRow.region,
        city: cleanRow.city,
        interviewer: cleanRow.interviewer,
        channel: cleanRow.channel,
        questionCode: orig,
        answerText: textVal,
        answerNum: numVal,
        rawJson: r,
        cleanJson: cleanRow
      });
      pushed++;
    }

    // guarantee at least one fact per row so respondents get counted
    if (pushed === 0) {
      outFacts.push({
        respondentId: cleanRow.respondentId,
        interviewDate: cleanRow.interviewDate,
        region: cleanRow.region,
        city: cleanRow.city,
        interviewer: cleanRow.interviewer,
        channel: cleanRow.channel,
        questionCode: '_row_presence',
        answerText: '1',
        answerNum: 1,
        rawJson: r,
        cleanJson: cleanRow
      });
    }
  }

  return { facts: outFacts, issues };
}

module.exports = { consolidateRows };