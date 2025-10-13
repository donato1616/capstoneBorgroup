import dayjs from "dayjs";
import { CANON, normalizeHeader, isQuestionCol } from "./canonical.js";
import _ from "lodash";

// find a value by trying multiple candidate headers
function pick(row, candidates, normMap) {
  if (!candidates) return undefined;
  for (const c of candidates) {
    const n = normalizeHeader(c);
    const rawKey = normMap[n] || c;
    const v = row[rawKey];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

// best-effort date parse
function parseDate(v) {
  if (!v) return null;
  // ISO or Excel-ish
  const d = dayjs(v);
  if (d.isValid()) return d.toDate();
  return null;
}

// numeric parse
function parseNum(v) {
  const n = Number(String(v).replace(/,/g,"").trim());
  return isNaN(n) ? null : n;
}

export function consolidateRows(rows, mapping, normMap) {
  const outFacts = [];
  const issues = [];

  const canon = {
    ...CANON,
    ...mapping.canonical
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    const respondentId = pick(r, canon.respondentId, normMap);
    const interviewDate = parseDate(pick(r, canon.interviewDate, normMap));
    const region = pick(r, canon.region, normMap);
    const city = pick(r, canon.city, normMap);
    const interviewer = pick(r, canon.interviewer, normMap);
    const channel = pick(r, canon.channel, normMap);

    // derive a base clean row for reuse in facts
    const cleanRow = {
      respondentId: respondentId ? String(respondentId).trim() : null,
      interviewDate,
      region: region ? String(region).trim() : null,
      city: city ? String(city).trim() : null,
      interviewer: interviewer ? String(interviewer).trim() : null,
      channel: channel ? String(channel).trim() : null
    };

    if (!cleanRow.respondentId) {
      issues.push({ row: i, type: "missing_respondent_id" });
      continue; // cannot index facts without id
    }

    // pivot all question columns
    for (const key of Object.keys(r)) {
      const nk = normalizeHeader(key);
      if (!isQuestionCol(nk)) continue;

      const rawVal = r[key];
      const fact = {
        respondentId: cleanRow.respondentId,
        interviewDate: cleanRow.interviewDate,
        region: cleanRow.region,
        city: cleanRow.city,
        interviewer: cleanRow.interviewer,
        channel: cleanRow.channel,
        questionCode: key,
        answerText: rawVal === "" ? null : String(rawVal),
        answerNum: parseNum(rawVal),
        rawJson: r,
        cleanJson: cleanRow
      };
      // only push if we have at least some value
      if (fact.answerText !== null || fact.answerNum !== null) {
        outFacts.push(fact);
      }
    }
  }

  return { facts: outFacts, issues };
}
