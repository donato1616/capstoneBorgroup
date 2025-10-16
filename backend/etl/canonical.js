// backend/etl/canonical.js (CommonJS)

// Canonical column targets we care about across all surveys
const CANON = {
    respondentId: ["Respondent.Serial", "SbjNum", "RespondentID", "RespID"],
    interviewDate: ["DataCollection.FinishTime", "Date", "InterviewDate"],
    region: ["Region", "REGION", "Area"],
    city: ["City", "CITY", "Municipality"],
    interviewer: ["Srvyr", "Interviewer", "FieldWorker", "InterviewerName"],
    channel: ["Channel", "Mode", "ModeOfInterview"]
  };
  
  // quick header normalization
  function normalizeHeader(h) {
    return String(h || "")
      .replace(/\.+/g, ".")
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9_]/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
  }
  
  // guess if a column is a question
  function isQuestionCol(col) {
    const c = col.toLowerCase();
    return /^q\d/.test(c) || /_q\d/.test(c) || /brand|aware|usage|attitude|satisfaction|nps/.test(c);
  }
  
  module.exports = { CANON, normalizeHeader, isQuestionCol };
  