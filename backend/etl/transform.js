// backend/etl/transform.js (CommonJS)
const dayjs = require('dayjs');
const crypto = require('crypto');
const { CANON, normalizeHeader, isQuestionCol: isQuestionColHeuristic } = require('./canonical');

// whitelist of meta/non-question fields to exclude from pivot (normalized header names)
const META_HEADERS = new Set([
  'respondent_serial','respondentid','respondent_id','resp_id','sbjnum',
  'datacollection_finishtime','datacollection_starttime','interviewdate','date','upload',
  'region','area','city','municipality','barangay','province',
  'srvyr','interviewer','fieldworker','interviewername',
  'mode','channel','modeofinterview',
  'latitude','longitude','gps_lat','gps_lng','gps_latitude','gps_longitude',
  'starttime','endtime','duration','duration_sec','is_complete','status'
]);

// find a value by trying multiple candidate headers
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

function parseDate(v) {
  if (!v) return null;
  const d = dayjs(v);
  return d.isValid() ? d.toDate() : null;
}

function parseNum(v) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

// broadened question detector: use heuristic OR treat any non-meta text/number column as a question
function isQuestionCol(headerNorm) {
  if (META_HEADERS.has(headerNorm)) return false;
  if (isQuestionColHeuristic(headerNorm)) return true;
  // treat columns that look like measures/labels as questions (e.g., 'brand_awareness','nps_score','satisfaction')
  if (/(brand|aware|usage|attitude|satisfaction|nps|score|rating|likelihood|purchase|intend|loyalty|visit|share)/i.test(headerNorm)) {
    return true;
  }
  // generic fallback: allow if it's not obviously an ID/date/geo/meta and not empty in most rows (checked later)
  return true;
}

function syntheticId(row, i) {
  // stable synthetic id from row content to avoid collisions across reuploads
  const h = crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex').slice(0, 10);
  return `resp_${i + 1}_${h}`;
}

function consolidateRows(rows, mapping = {}, normMap = {}) {
  const outFacts = [];
  const issues = [];

  const canon = { ...CANON, ...(mapping.canonical || {}) };

  // precompute normalized header -> original key map
  const normalizedToOriginal = normMap;

  // If we’re using the broad fallback, we’ll skip columns that are 100% blank
  const headers = Object.keys(rows[0] || {});
  const headerNorms = headers.map(h => ({ norm: normalizeHeader(h), orig: h }));

  // detect columns that are completely blank to exclude from pivot
  const nonBlankColumns = new Set();
  for (const { norm, orig } of headerNorms) {
    const any = rows.some(r => r[orig] !== '' && r[orig] !== null && r[orig] !== undefined);
    if (any) nonBlankColumns.add(norm);
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    const respondentIdRaw = pick(r, canon.respondentId, normalizedToOriginal);
    const interviewDate = parseDate(pick(r, canon.interviewDate, normalizedToOriginal));
    const region = pick(r, canon.region, normalizedToOriginal);
    const city = pick(r, canon.city, normalizedToOriginal);
    const interviewer = pick(r, canon.interviewer, normalizedToOriginal);
    const channel = pick(r, canon.channel, normalizedToOriginal);

    // if respondentId missing, synthesize one so we don’t drop the row
    const respondentId = respondentIdRaw ? String(respondentIdRaw).trim() : syntheticId(r, i);
    if (!respondentIdRaw) {
      issues.push({ row: i, type: 'synthetic_respondent_id' });
    }

    const cleanRow = {
      respondentId,
      interviewDate,
      region: region ? String(region).trim() : null,
      city: city ? String(city).trim() : null,
      interviewer: interviewer ? String(interviewer).trim() : null,
      channel: channel ? String(channel).trim() : null
    };

    // pivot columns
    for (const { norm, orig } of headerNorms) {
      if (!nonBlankColumns.has(norm)) continue;          // skip all-blank columns
      if (!isQuestionCol(norm)) continue;               // skip meta columns

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
        questionCode: orig,       // keep original header for readability in UI
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
