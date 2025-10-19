// backend/etl/transform.js (CommonJS)
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
  'srvyr','interviewer','fieldworker','interviewername','interviewer_id',
  'mode','channel','modeofinterview','interview_mode',
  'latitude','longitude','gps_lat','gps_lng','gps_latitude','gps_longitude',
  'duration','duration_sec','is_complete','status'
]);

// map normalized header -> original header
// pick tries a list of candidate header names (raw) and returns the first non-empty value
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
  // discard impossible ranges
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

  // try a few common textual formats
  const trials = [
    'YYYY-MM-DD',
    'YYYY/MM/DD',
    'MM/DD/YYYY', 'M/D/YYYY',
    'DD/MM/YYYY', 'D/M/YYYY',
    'YYYY-MM-DD HH:mm:ss',
    'MM/DD/YYYY HH:mm', 'DD/MM/YYYY HH:mm',
    'D MMM YYYY', 'DD-MMM-YYYY', 'YYYY-MMM-DD',
  ];
  for (const f of trials) {
    const d = dayjs(String(v).trim(), f, true);
    if (d.isValid()) return d.toDate();
  }

  // final loose parse
  const d = dayjs(v);
  if (d.isValid()) return d.toDate();

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
  // allow generic measures that aren't obvious meta fields
  if (/(score|rating|rank|value|count|amount|index|total|pct|percent)/i.test(headerNorm)) return true;
  return false;
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

    const respondentIdRaw = pick(r, canon.respondentId, normMap);
    const interviewDate = parseDate(pick(r, canon.interviewDate, normMap));
    const region = pick(r, canon.region, normMap);
    const city = pick(r, canon.city, normMap);
    const interviewer = pick(r, canon.interviewer, normMap);
    const channel = pick(r, canon.channel, normMap);

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
        questionCode: orig,     // keep original header for readability
        answerText: textVal,
        answerNum: numVal,
        rawJson: r,
        cleanJson: cleanRow
      });
    }
  }

  return { facts: outFacts, issues };
}

module.exports = { consolidateRows };
