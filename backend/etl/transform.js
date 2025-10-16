// backend/etl/transform.js (ESM version)
import dayjs from "dayjs";
import crypto from "crypto";
import { CANON, normalizeHeader, isQuestionCol as isQuestionColHeuristic } from "./canonical.js";

const META_HEADERS = new Set([
  'respondent_serial','respondentid','respondent_id','resp_id','sbjnum',
  'datacollection_finishtime','datacollection_starttime','interviewdate','date','upload',
  'region','area','city','municipality','barangay','province',
  'srvyr','interviewer','fieldworker','interviewername',
  'mode','channel','modeofinterview',
  'latitude','longitude','gps_lat','gps_lng','gps_latitude','gps_longitude',
  'starttime','endtime','duration','duration_sec','is_complete','status'
]);

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

function isQuestionCol(headerNorm) {
  if (META_HEADERS.has(headerNorm)) return false;
  if (isQuestionColHeuristic(headerNorm)) return true;
  if (/(brand|aware|usage|attitude|satisfaction|nps|score|rating|likelihood|purchase|intend|loyalty|visit|share)/i.test(headerNorm))
    return true;
  return true;
}

function syntheticId(row, i) {
  const h = crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex').slice(0, 10);
  return `resp_${i + 1}_${h}`;
}

export function consolidateRows(rows, mapping = {}, normMap = {}) {
  const outFacts = [];
  const issues = [];

  const canon = { ...CANON, ...(mapping.canonical || {}) };
  const normalizedToOriginal = normMap;
  const headers = Object.keys(rows[0] || {});
  const headerNorms = headers.map(h => ({ norm: normalizeHeader(h), orig: h }));

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
    }
  }

  return { facts: outFacts, issues };
}
