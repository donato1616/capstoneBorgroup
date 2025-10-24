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
  'remarks','comment','comments','note','notes' // we’ll read dates from these but don’t treat as questions
]);

// map normalized header -> original header
function pick(row, candidates, normMap) {
  if (!candidates) return undefined;
  for (const c of candidates) {
    const n = normalizeHeader(c);
    const rawKey = normMap[n] || c;        // original header key if loader exposed it
    const v = row[rawKey];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

// Excel serial (days since 1899-12-30) → Date
function excelSerialToDate(num) {
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  if (n < 59 || n > 100000) return null;
  const base = Date.UTC(1899, 11, 30);
  return new Date(base + n * 86400000);
}

// robust date parser for strings, numbers, and Excel dumps
function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;

  // numeric serial or numeric string
  if (typeof v === 'number' || (typeof v === 'string' && /^[0-9.]+$/.test(v.trim()))) {
    const d = excelSerialToDate(v);
    if (d) return d;
  }

  const trials = [
    'YYYY-MM-DD', 'YYYY/MM/DD',
    'MM/DD/YYYY','M/D/YYYY',
    'DD/MM/YYYY','D/M/YYYY',
    'YYYY-MM-DD HH:mm:ss',
    'MM/DD/YYYY HH:mm','DD/MM/YYYY HH:mm',
    'D MMM YYYY','DD-MMM-YYYY','YYYY-MMM-DD',
  ];
  for (const f of trials) {
    const d = dayjs(String(v).trim(), f, true);
    if (d.isValid()) return d.toDate();
  }

  const d = dayjs(v);
  if (d.isValid()) return d.toDate();
  return null;
}

// parse date tokens hiding inside free-text like “062725 - …” or “6/27/25”
function parseDateFromFreeText(text) {
  if (!text) return null;
  const s = String(text);

  // 6-digit token, assume MMDDYY by default (e.g., 062725 => 2025-06-27)
  const m6 = s.match(/\b(\d{6})\b/);
  if (m6) {
    const t = m6[1];
    const mm = Number(t.slice(0,2));
    const dd = Number(t.slice(2,4));
    let yy = Number(t.slice(4,6));
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      yy = yy + (yy >= 70 ? 1900 : 2000); // 70–99 → 19xx, else 20xx
      return new Date(yy, mm - 1, dd);
    }
  }

  // with separators: 6/27/25 or 27-06-2025
  const mSep = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (mSep) {
    let a = Number(mSep[1]), b = Number(mSep[2]), c = Number(mSep[3]);
    const yyyy = c < 100 ? c + 2000 : c;
    // prefer MM/DD/YY if both plausible; switch if first token > 12
    let mm = a, dd = b;
    if (a > 12 && b <= 12) { mm = b; dd = a; }
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return new Date(yyyy, mm - 1, dd);
  }
  return null;
}

// scan any string cell for a date
function findAnyDateInRow(row) {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v == null) continue;
    const direct = parseDate(v);
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
  return true; // be permissive for ragged spreadsheets
}

function syntheticId(row, i) {
  const h = crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex').slice(0, 10);
  return `resp_${i + 1}_${h}`;
}

function consolidateRows(rows, mapping = {}, normMap = {}) {
  const outFacts = [];
  const issues = [];
  const canon = { ...CANON, ...(mapping.canonical || {}) };

  // headers + normalized versions
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

    // try canonical fields first
    const respondentIdRaw = pick(r, canon.respondentId, normMap) ||
                            r['Rno'] || r['RNO'] || r['rno']; // common roster fields
    let interviewDate = parseDate(pick(r, canon.interviewDate, normMap));
    const region = pick(r, canon.region, normMap) || r['Area'] || r['area'];
    const city = pick(r, canon.city, normMap);
    const interviewer = pick(r, canon.interviewer, normMap) || r['Recruiter'] || r['recruiter'];
    const channel = pick(r, canon.channel, normMap);

    // fallback: date hiding in remarks / any string
    if (!interviewDate) {
      const frmRemarks = parseDateFromFreeText(
        pick(r, ['remarks','comment','comments','note','notes','status'], normMap)
      );
      interviewDate = frmRemarks || findAnyDateInRow(r);
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

    // pivot each non-blank, non-meta column as a "fact"
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
        questionCode: orig,     // keep original header for readability
        answerText: textVal,
        answerNum: numVal,
        rawJson: r,
        cleanJson: cleanRow
      });
      pushed++;
    }

    // If nothing qualified as a question (common for roster/status sheets),
    // ensure at least one fact so the respondent is counted.
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