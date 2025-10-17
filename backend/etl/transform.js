// backend/etl/transform.js (CommonJS)
const dayjs = require('dayjs');
const crypto = require('crypto');
const { CANON, normalizeHeader, isQuestionCol: isQuestionColHeuristic } = require('./canonical');

// Build a meta-header blocklist dynamically from CANON + common admin fields.
// We normalize every alias so we don't accidentally pivot meta fields as questions.
const META_HEADERS = (() => {
  const s = new Set([
    // generic admin/meta fields
    'datacollection_finishtime','datacollection_starttime','finish_time','start_time',
    'interviewdate','interview_date','date','survey_date','submissiondate','submission_date',
    'upload','created_at','updated_at',
    'region','area','territory','zone','cluster','state','province','district',
    'city','city_municipality','municipality','barangay',
    'srvyr','interviewer','fieldworker','interviewername','agent','agentname','enumerator','surveyor',
    'mode','channel','modeofinterview','interview_mode','collection_mode',
    'latitude','longitude','gps_lat','gps_lng','gps_latitude','gps_longitude',
    'starttime','endtime','duration','duration_sec','is_complete','status'
  ]);

  // add all CANON aliases (normalized)
  for (const key of Object.keys(CANON)) {
    for (const alias of CANON[key]) s.add(normalizeHeader(alias));
  }

  // common id-ish fields
  [
    'respondent_serial','respondentid','respondent_id','respondent','resp_id','respid',
    'sbjnum','recordid','record_id','uuid','uid','unique_id','imei','msisdn','mobile','phone','contact_number','id'
  ].forEach(v => s.add(v));

  return s;
})();

// find a value by trying multiple candidate headers (using normMap the loader provides)
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

// broadened question detector: allow likely measures, block known meta
function isQuestionCol(headerNorm) {
  if (META_HEADERS.has(headerNorm)) return false;
  if (isQuestionColHeuristic(headerNorm)) return true;

  // still allow many non-meta columns; exclude obvious admin/coordinates/identity
  if (!/(id|uuid|imei|msisdn|name|first|last|email|phone|mobile|lat|lng|long|longitude|latitude|start|end|date|time)/i.test(headerNorm)) {
    return true;
  }
  return false;
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

  // If there are no rows, bail early
  if (!rows || !rows.length) return { facts: outFacts, issues };

  // precompute normalized header -> original key map (already provided by loader)
  const normalizedToOriginal = normMap;

  // Evaluate headers once
  const headers = Object.keys(rows[0] || {});
  const headerNorms = headers.map(h => ({ norm: normalizeHeader(h), orig: h }));

  // Exclude columns that are 100% blank across the file
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

    // synthesize respondent id if missing
    const respondentId = respondentIdRaw ? String(respondentIdRaw).trim() : syntheticId(r, i);
    if (!respondentIdRaw) issues.push({ row: i, type: 'synthetic_respondent_id' });

    const cleanRow = {
      respondentId,
      interviewDate,
      region: region ? String(region).trim() : null,
      city: city ? String(city).trim() : null,
      interviewer: interviewer ? String(interviewer).trim() : null,
      channel: channel ? String(channel).trim() : null
    };

    // pivot columns → long-form facts
    for (const { norm, orig } of headerNorms) {
      if (!nonBlankColumns.has(norm)) continue;    // skip all-blank columns
      if (!isQuestionCol(norm)) continue;          // skip meta columns

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
