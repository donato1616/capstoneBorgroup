// backend/etl/canonical.js (CommonJS)

// Canonical column targets we care about across all surveys
// — extended aliases so we can extract IDs/dates/regions/interviewers from varied supplier headers.
const CANON = {
    respondentId: [
      // your originals
      "Respondent.Serial", "SbjNum", "RespondentID", "RespID",
      // frequent vendor alternates
      "Respondent", "Respondent_ID", "Respondent Id", "ResponseID", "Response_ID",
      "RecordID", "Record_ID", "Record Id", "UUID", "Uid", "Unique_ID",
      "MSISDN", "IMEI", "Mobile", "Phone", "Contact_Number", "Contact No",
      "SBJNUM", "Sbj No", "Resp Id", "ID", "id"
    ],
  
    interviewDate: [
      // your originals
      "DataCollection.FinishTime", "Date", "InterviewDate",
      // alternates we’ve seen a lot
      "DataCollection.StartTime", "FinishTime", "StartTime",
      "SubmissionDate", "Submission Date", "Survey_Date", "Survey Date",
      "Start_Date", "End_Date", "StartDate", "EndDate", "Interview Date",
      "CreatedAt", "UpdatedAt", "created_at", "updated_at"
    ],
  
    region: [
      // your originals
      "Region", "REGION", "Area",
      // alternates
      "Territory", "Zone", "Cluster", "State", "Province", "District",
      "City", "City/Municipality", "Municipality", "Barangay"
    ],
  
    city: [
      // your originals
      "City", "CITY", "Municipality",
      // alternates
      "City/Municipality", "Town", "Locality"
    ],
  
    interviewer: [
      // your originals
      "Srvyr", "Interviewer", "FieldWorker", "InterviewerName",
      // alternates
      "Enumerator", "Agent", "AgentName", "Surveyor", "Interviewer_Name", "FieldWorkerName"
    ],
  
    channel: [
      // your originals
      "Channel", "Mode", "ModeOfInterview",
      // alternates
      "Interview_Mode", "Collection_Mode", "Mode of Interview"
    ]
  };
  
  // quick header normalization (kept)
  function normalizeHeader(h) {
    return String(h || "")
      .replace(/\.+/g, ".")
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9_]/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
  }
  
  // heuristic: likely “question” column names
  // We keep it permissive to catch non Q* measures (e.g., Satisfaction_Score, NPS, Recommend, etc.)
  function isQuestionCol(col) {
    const c = String(col || "").toLowerCase();
  
    // classic Q codes
    if (/^q[\d_]/i.test(c)) return true;
  
    // common research signals
    if (
      /(brand|aware|awareness|usage|attitude|satisfaction|nps|score|rating|likelihood|purchase|intend|intention|loyalty|visit|share|agree|disagree|recommend|top2|top3|rank|frequency)/i
        .test(c)
    ) return true;
  
    return false;
  }
  
  module.exports = { CANON, normalizeHeader, isQuestionCol };
  