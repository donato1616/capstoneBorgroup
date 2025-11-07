// backend/etl/canonical.js (ESM version)

/**
 * Canonical logical fields and a wide set of vendor/partner alternates.
 * These lists are intentionally generous to keep the ETL resilient.
 */
export const CANON = {
  respondentId: [
    // originals
    'Respondent.Serial','SbjNum','RespondentID','RespID',
    // frequent alternates
    'Respondent','Respondent_ID','Respondent Id','ResponseID','Response_ID',
    'RecordID','Record_ID','Record Id','UUID','Uid','Unique_ID',
    'MSISDN','IMEI','Mobile','Phone','Contact_Number','Contact No',
    'SBJNUM','Sbj No','Resp Id','ID','id','Rno','RNO','rno'
  ],

  interviewDate: [
    // originals & known positions
    'DataCollection.FinishTime','Date','InterviewDate',
    // common alternates
    'DataCollection.StartTime','FinishTime','StartTime',
    'SubmissionDate','Submission Date','Survey_Date','Survey Date',
    'Start_Date','End_Date','StartDate','EndDate','Interview Date',
    'CreatedAt','UpdatedAt','created_at','updated_at','Timestamp','TimeStamp',
    // extra vendor-ish names
    'visit_date','date_of_visit','fsr_date','fsrdate','visit','schedule',
    'datetime','date_time','survey_datetime'
  ],

  region: [
    'Region','REGION','Area','SEC14b','QRegion',
    'Territory','Zone','Cluster','State','Province','District',
    'City','City/Municipality','Municipality','Barangay','QProvince',
    'Location','Loc_Region','RegionName','Region_Name'
  ],

  city: [
    'City','CITY','Municipality','City/Municipality','Town','Locality','City_Town'
  ],

  interviewer: [
    'Srvyr','Interviewer','FieldWorker','InterviewerName',
    'Enumerator','Agent','AgentName','Surveyor','Interviewer_Name','FieldWorkerName',
    'InterviewerID','Interviewer_ID','Interviewer Id','Recruiter','recruiter'
  ],

  channel: [
    'Channel','Mode','ModeOfInterview','Interview_Mode',
    'Collection_Mode','Mode of Interview','Survey_Mode','Method'
  ],
};

/** Normalize a raw header to a lowercased, safe token. */
export function normalizeHeader(h) {
  return String(h || '')
    .replace(/\.+/g, '.')      // collapse dots
    .replace(/\s+/g, '_')      // spaces -> _
    .replace(/[^A-Za-z0-9_.]/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/** Heuristic: columns that look like survey questions / measures. */
export function isQuestionCol(col) {
  const c = String(col || '').toLowerCase();

  // Skip known script and system columns
  if (c.startsWith('script_') || 
      c.startsWith('set_') || 
      c.startsWith('punch_') || 
      c.startsWith('enable_') ||
      c.startsWith('to_punch_') ||
      c.startsWith('var') ||
      c.includes('_redirect_') ||
      c.includes('endpagemessage') ||
      c.includes('privacy') ||
      c.includes('commission') ||
      c.includes('fielding') ||
      c.includes('lang') ||
      c.includes('country') ||
      c.includes('track') ||
      c.includes('studyid') ||
      c.includes('week') ||
      c.includes('session') ||
      c.includes('year') ||
      c.includes('capicountry') ||
      c.includes('hqtrack') ||
      c.includes('src') ||
      c.includes('boost') ||
      c.includes('userid') ||
      c.includes('password') ||
      c.includes('email') ||
      c.includes('ourlink') ||
      c.includes('qredirects') ||
      c.includes('qquid') ||
      c.includes('sname') ||
      c.includes('gid') ||
      c.includes('tolunaenc') ||
      c.includes('varstatus') ||
      c.includes('uid') ||
      c.includes('pid') ||
      c.includes('psid') ||
      c.includes('keyid') ||
      c.includes('hash') ||
      c.includes('skey') ||
      c.includes('dynendlinks') ||
      c.includes('basic') ||
      c.includes('high') ||
      c.includes('resaid') ||
      c.includes('vase_responseid') ||
      c.includes('ipid') ||
      c.includes('insp') ||
      c.includes('insightspedia')) {
    return false;
  }

  // classic Q-codes (more specific patterns)
  if (/^q[_\-]?\d+$/i.test(c)) return true;
  if (/^q[_\-]?\d+[a-z]?$/i.test(c)) return true;
  
  // Look for question patterns in complex headers
  if (/^q[_\-]?\d+[a-z]?[_\-].+/i.test(c)) {
    // This looks like Q1_SomeText or Q2-Something
    return true;
  }

  // common research signals - be more specific
  const questionPatterns = [
    'brand', 'aware', 'awareness', 'usage', 'attitude', 'satisfaction', 
    'nps', 'score', 'rating', 'likelihood', 'purchase', 'intend', 
    'intention', 'loyalty', 'visit', 'share', 'agree', 'disagree', 
    'recommend', 'top2', 'top3', 'rank', 'frequency', 'price', 
    'value', 'quality', 'trust', 'quota', 'mins', 'hours', 'age', 
    'income', 'gender', 'segment', 'category', 'preference', 'choice',
    'selection', 'option', 'answer', 'response', 'feedback', 'comment',
    'opinion', 'thought', 'feeling', 'experience', 'behavior', 'habit'
  ];

  for (const pattern of questionPatterns) {
    if (c.includes(pattern)) {
      return true;
    }
  }

  return false;
}

// Additional helper function to identify metadata columns more aggressively
export function isMetadataCol(col) {
  const c = String(col || '').toLowerCase();
  
  const metadataPatterns = [
    'script_', 'set_', 'punch_', 'enable_', 'to_punch_', 'var', 
    '_redirect_', 'endpagemessage', 'privacy', 'commission', 'fielding',
    'lang', 'country', 'track', 'studyid', 'week', 'session', 'year',
    'capicountry', 'hqtrack', 'src', 'boost', 'userid', 'password',
    'email', 'ourlink', 'qredirects', 'qquid', 'sname', 'gid', 'tolunaenc',
    'varstatus', 'uid', 'pid', 'psid', 'keyid', 'hash', 'skey', 'dynendlinks',
    'basic', 'high', 'resaid', 'vase_responseid', 'ipid', 'insp', 'insightspedia',
    'sbjnum', 'filter', 'date', 'srvyr', 'sbjnam', 'usrunq', 'netduration', 
    'duration', 'upload', 'subjdata', 'rvwtime', 'rvwcomment', 'srvyrcomment', 
    'complete', 'stopq', 'test', 'parentid', 'latitude', 'longitude', 'status', 
    'utcdiff', 'qascore', 'frscname', 'exrenum', 'vstart', 'vend', 'rvwname', 
    'cancel', 'root score', 'main chapter', 'sampletype'
  ];

  for (const pattern of metadataPatterns) {
    if (c.includes(pattern)) {
      return true;
    }
  }

  return false;
}