// backend/etl/canonical.js (CommonJS)

// Canonical column targets we care about across all surveys
// Extended with many vendor alternates so ETL stays resilient.
const CANON = {
  respondentId: [
    // originals
    "Respondent.Serial","SbjNum","RespondentID","RespID",
    // frequent alternates
    "Respondent","Respondent_ID","Respondent Id","ResponseID","Response_ID",
    "RecordID","Record_ID","Record Id","UUID","Uid","Unique_ID",
    "MSISDN","IMEI","Mobile","Phone","Contact_Number","Contact No",
    "SBJNUM","Sbj No","Resp Id","ID","id"
  ],

  interviewDate: [
    // originals
    "DataCollection.FinishTime","Date","InterviewDate",
    // common alternates
    "DataCollection.StartTime","FinishTime","StartTime",
    "SubmissionDate","Submission Date","Survey_Date","Survey Date",
    "Start_Date","End_Date","StartDate","EndDate","Interview Date",
    "CreatedAt","UpdatedAt","created_at","updated_at","Timestamp","TimeStamp"
  ],

  region: [
    "Region","REGION","Area","SEC14b","QRegion",
    "Territory","Zone","Cluster","State","Province","District",
    "City","City/Municipality","Municipality","Barangay","QProvince",
    "Location","Loc_Region","RegionName","Region_Name"
  ],

  city: [
    "City","CITY","Municipality","City/Municipality","Town","Locality","City_Town"
  ],

  interviewer: [
    "Srvyr","Interviewer","FieldWorker","InterviewerName",
    "Enumerator","Agent","AgentName","Surveyor","Interviewer_Name","FieldWorkerName",
    "InterviewerID","Interviewer_ID","Interviewer Id"
  ],

  channel: [
    "Channel","Mode","ModeOfInterview",
    "Interview_Mode","Collection_Mode","Mode of Interview","Survey_Mode","Method"
  ]
};

// quick header normalization (used by loader/transform)
function normalizeHeader(h) {
  return String(h || "")
    .replace(/\.+/g, ".")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

// heuristic: columns that look like survey questions / measures
function isQuestionCol(col) {
  const c = String(col || "").toLowerCase();

  // classic Q-codes
  if (/^q[\d_]/i.test(c)) return true;

  // common research signals
  if (/(brand|aware|awareness|usage|attitude|satisfaction|nps|score|rating|likelihood|purchase|intend|intention|loyalty|visit|share|agree|disagree|recommend|top2|top3|rank|frequency|price|value|quality|trust)/i.test(c)) {
    return true;
  }

  return false;
}

module.exports = { CANON, normalizeHeader, isQuestionCol };
