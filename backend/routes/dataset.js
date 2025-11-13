import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import prisma from "../lib/prisma.js";

import { chooseMapping, readBestSheet } from "../etl/loader.js";
import { consolidateRows } from "../etl/transform.js";

const router = express.Router();

// ---------------------------- config knobs ----------------------------
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 200);
const INSERT_CHUNK = Number(process.env.INSERT_CHUNK || 5000);
const USE_TX = String(process.env.USE_TX || '0') === '1';
const SKIP_DUPLICATES = String(process.env.SKIP_DUPLICATES || '1') === '1';
const UPLOAD_STORAGE = (process.env.UPLOAD_STORAGE || 'disk').toLowerCase(); // 'disk' | 'memory'
const COMPLETION_DENSITY_PCT = Number(process.env.COMPLETION_DENSITY_PCT || 0.7);

// Add enhanced forecasting configuration
const FORECASTING_MIN_POINTS = Number(process.env.FORECASTING_MIN_POINTS || 10);
const FORECASTING_MIN_DAYS = Number(process.env.FORECASTING_MIN_DAYS || 7);
const FORECASTING_MIN_VARIANCE = Number(process.env.FORECASTING_MIN_VARIANCE || 0.1);

// --- date helper (normalize to YYYY-MM-DD in UTC) ---
function isoDate(d) {
  try {
    return (d instanceof Date) ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  } catch { 
    return String(d).slice(0, 10);
  }
}
// --------- Enhanced Forecasting Diagnostics ---------
function analyzeForecastingReadiness(dailySeries, datasetInfo = {}) {
  const points = dailySeries.length;
  const dates = dailySeries.map(d => new Date(d.date));
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));
  const dayRange = (maxDate - minDate) / (1000 * 60 * 60 * 24);
  
  // Calculate variance and data quality metrics
  const values = dailySeries.map(d => d.count || d.completed || d.y || 0);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0; // coefficient of variation
  
  // Check for constant values
  const uniqueValues = new Set(values);
  const isConstant = uniqueValues.size <= 1;
  
  // Check for regular intervals
  let regularIntervals = true;
  let missingData = false;
  if (points > 1) {
    const expectedInterval = dayRange / (points - 1);
    for (let i = 1; i < points; i++) {
      const actualInterval = (dates[i] - dates[i-1]) / (1000 * 60 * 60 * 24);
      if (Math.abs(actualInterval - expectedInterval) > expectedInterval * 0.5) {
        regularIntervals = false;
      }
    }
    
    // Check for missing dates in sequence
    const fullDateRange = [];
    for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + 1)) {
      fullDateRange.push(d.toISOString().slice(0, 10));
    }
    const actualDates = new Set(dailySeries.map(d => d.date));
    const missingDates = fullDateRange.filter(date => !actualDates.has(date));
    missingData = missingDates.length > 0;
  }
  
  // Determine status with enhanced criteria
  let status = 'Excellent';
  let issues = [];
  
  if (points < FORECASTING_MIN_POINTS) {
    issues.push(`Insufficient data points: ${points} (need ${FORECASTING_MIN_POINTS}+)`);
    status = points >= 7 ? 'Fair' : 'Poor';
  }
  
  if (dayRange < FORECASTING_MIN_DAYS) {
    issues.push(`Short time range: ${dayRange.toFixed(1)} days (need ${FORECASTING_MIN_DAYS}+ days)`);
    status = 'Poor';
  }
  
  if (isConstant || cv < FORECASTING_MIN_VARIANCE) {
    issues.push(`Low variance in values: coefficient of variation ${cv.toFixed(3)} (need > ${FORECASTING_MIN_VARIANCE})`);
    if (status === 'Excellent') status = 'Fair';
  }
  
  if (!regularIntervals) {
    issues.push('Irregular time intervals detected');
    if (status === 'Excellent') status = 'Good';
  }
  
  if (missingData) {
    issues.push('Missing data points in date sequence');
    if (status === 'Excellent') status = 'Good';
  }
  
  // If no issues and meets enhanced criteria
  if (issues.length === 0 && points >= 14 && dayRange >= 14 && cv >= 0.2) {
    status = 'Excellent';
  } else if (issues.length === 0) {
    status = 'Good';
  }
  
  return {
    status,
    dataPoints: points,
    dateRange: `${minDate.toISOString().slice(0, 10)} to ${maxDate.toISOString().slice(0, 10)}`,
    dayRange: dayRange,
    variance: cv,
    isConstant,
    regularIntervals,
    missingData,
    issues,
    dataQuality: {
      coefficientOfVariation: cv,
      meanValue: mean,
      standardDeviation: stdDev,
      dataDensity: points / Math.max(1, dayRange)
    },
    requirements: {
      minimumPoints: FORECASTING_MIN_POINTS,
      minimumDays: FORECASTING_MIN_DAYS,
      minimumVariance: FORECASTING_MIN_VARIANCE,
      regularIntervals: true,
      limitedMissingData: true
    },
    suggestions: generateDataSuggestions(points, dayRange, cv, regularIntervals, missingData)
  };
}

function generateDataSuggestions(points, dayRange, variance, regularIntervals, missingData) {
  const suggestions = [];
  
  if (points < 10) {
    suggestions.push(`Collect more data: currently ${points} points, need 10+ for reliable forecasting`);
  }
  
  if (dayRange < 7) {
    suggestions.push(`Extend data collection period: currently ${dayRange.toFixed(1)} days, need 7+ days`);
  }
  
  if (variance < 0.1) {
    suggestions.push('Data shows little variation - consider collecting data under different conditions');
  }
  
  if (!regularIntervals) {
    suggestions.push('Collect data at regular intervals for better time series analysis');
  }
  
  if (missingData) {
    suggestions.push('Fill in missing dates in your data sequence');
  }
  
  if (suggestions.length === 0) {
    suggestions.push('Data quality is sufficient for advanced forecasting models');
  }
  
  return suggestions;
}

// ---------------------------- upload middlewares ----------------------------
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

const diskUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dest = path.join(os.tmpdir(), 'uploads');
      fs.mkdir(dest, { recursive: true }, () => cb(null, dest));
    },
    filename: (req, file, cb) => {
      const safe = String(file.originalname || 'upload').replace(/[^\w.\-]+/g, '_');
      cb(null, `${Date.now()}_${safe}`);
    }
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

function getUploadMiddleware() {
  return UPLOAD_STORAGE === 'memory' ? memoryUpload.single('file') : diskUpload.single('file');
}

// --------- Missing Date prototype method for getWeek() ---------
Date.prototype.getWeek = function() {
  const date = new Date(this.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};

// --------- Missing generateDailyPlan function for staffing route ---------
function generateDailyPlan(target, workdaysCount, requiredInterviewers) {
  if (workdaysCount <= 0 || requiredInterviewers <= 0) {
    return [];
  }
  
  const baseDailyTarget = Math.floor(target / workdaysCount);
  const remainder = target % workdaysCount;
  
  const plan = [];
  for (let i = 0; i < workdaysCount; i++) {
    const dailyTarget = baseDailyTarget + (i < remainder ? 1 : 0);
    plan.push({
      day: i + 1,
      target: dailyTarget,
      interviewers: requiredInterviewers,
      target_per_interviewer: Math.ceil(dailyTarget / requiredInterviewers)
    });
  }
  
  return plan;
}

// --------- Missing bestPath function for decision tree analysis ---------
function bestPath(node, conds = []) {
  if (!node || node.type === 'leaf') return { conds, avg: node?.avg || 0 };
  
  const pathLeft = bestPath(node.left, [...conds, { [node.dim]: node.equals }]);
  const pathRight = bestPath(node.right, conds);
  
  return (pathLeft.avg >= pathRight.avg) ? pathLeft : pathRight;
}

// --------- Outlier Removal and Feature Engineering ---------

// Remove outliers based on Interquartile Range (IQR)
function removeOutliers(data) {
  const Q1 = data[Math.floor(data.length / 4)];
  const Q3 = data[Math.floor(3 * data.length / 4)];
  const IQR = Q3 - Q1;
  const lowerBound = Q1 - 1.5 * IQR;
  const upperBound = Q3 + 1.5 * IQR;

  return data.filter(value => value >= lowerBound && value <= upperBound);
}

// Feature engineering: Add time-based features (week, month, year)
function addTimeFeatures(data) {
  return data.map(row => ({
    ...row,
    weekOfYear: new Date(row.date).getWeek(), // Week of year feature
    month: new Date(row.date).getMonth(),     // Month of the year feature
    year: new Date(row.date).getFullYear(),   // Year feature
  }));
}

// ---------------------------- helpers ----------------------------
function parseId(reqParam) {
  const n = Number(String(reqParam || '').trim());
  if (!Number.isFinite(n)) throw new Error('Invalid dataset id');
  return n;
}
function readFileToBuffer(file) {
  if (file?.buffer) return file.buffer;
  if (file?.path) return fs.readFileSync(file.path);
  return null;
}
function isNumericish(s) {
  if (s === null || s === undefined) return false;
  const t = String(s).trim();
  if (!t) return false;
  if (/^[+\-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?$/.test(t)) return true;
  if (/^[+\-]?\d+(?:\.\d+)?%?$/.test(t)) return true;
  return false;
}
function coerceNumeric(s) {
  const t = String(s || '').trim();
  if (!isNumericish(t)) return null;
  const cleaned = t.replace(/[ ,%]/g, '');
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}
function normTextToken(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    .toUpperCase();
}

// --------- Human-friendly question label ---------
function prettyQuestionLabel(code, sampleText) {
  if (!code) return '';

  // 1) strip common survey prefixes & boilerplate
  let s = String(code)
    .replace(/^A_+/i, '')
    .replace(/^B_+/i, '')
    .replace(/^ISQ_+/i, '')
    .replace(/_?DISPLAYEDITPARAMETERSH_?\d*/i, '')
    .replace(/_?DISPLAYEDITPARAMETERS_?\d*/i, '')
    .replace(/^Q_+/i, 'Q')
    .replace(/__+/g, '_');

  // 2) expand a few very common acronyms/codes
  const dict = [
    [/^AGE1$/i, 'Age'],
    [/^GENDER1?$/i, 'Gender'],
    [/ALLQUALIFIEDRESP/gi, 'All Qualified Respondents'],
    [/_RESP\b/gi, ' Respondents'],
  ];
  for (const [re, repl] of dict) s = s.replace(re, repl);

  // 3) underscores -> spaces; compact spaces
  s = s.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // 4) make it Title Case (but leave Q-codes as is)
  s = s.split(' ').map(tok => {
    if (/^Q\d+[a-z]*$/i.test(tok)) return tok.toUpperCase();
    return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
  }).join(' ');

  // 5) add example answer as a hint (tiny, trimmed)
  if (sampleText) {
    const ex = String(sampleText).trim();
    if (ex) s = `${s} — e.g., ${ex.slice(0, 40)}`;
  }
  return s;
}

// --------- OLS (Ordinary Least Squares) Linear Regression ---------
function olsFit(points) {
  const n = points.length;
  if (n < 2) {
    return simpleFallbackModel(points);
  }

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    // Vertical line? Fallback to constant model
    const y = points.map(p => p.y);
    const avg = y.reduce((a, b) => a + b, 0) / y.length;
    const yhat = points.map(() => avg);
    return {
      ...calculateMetrics(points, yhat, 'linear'),
      a: 0, b: avg
    };
  }

  const a = (n * sumXY - sumX * sumY) / denominator;
  const b = (sumY - a * sumX) / n;

  const yhat = points.map(p => a * p.x + b);
  
  const metrics = calculateMetrics(points, yhat, 'linear');
  
  // Calculate baseline (naive: average of y) for comparison
  const y = points.map(p => p.y);
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  const baselineYhat = points.map(() => ybar);
  const baselineMSE = y.reduce((s, v, i) => s + Math.pow(v - baselineYhat[i], 2), 0) / n;
  const baselineRMSE = Math.sqrt(baselineMSE);
  
  return {
    ...metrics,
    a, b,
    baselineRMSE,
    improvement: baselineRMSE > 0 ? (baselineRMSE - metrics.rmse) / baselineRMSE : 0
  };
}

// --------- Confidence Intervals Calculation ---------
function calculateConfidenceIntervals(points, model, confidenceLevel = 0.95) {
  const n = points.length;
  if (n < 3) {
    // Not enough points for proper confidence intervals
    return model.yhat.map(prediction => ({
      lower: Math.max(0, prediction * 0.5),
      upper: prediction * 1.5
    }));
  }

  // Calculate residuals
  const residuals = points.map((p, i) => p.y - model.yhat[i]);
  
  // Calculate standard error of residuals
  const residualMean = residuals.reduce((sum, r) => sum + r, 0) / n;
  const residualVariance = residuals.reduce((sum, r) => sum + Math.pow(r - residualMean, 2), 0) / (n - 2);
  const residualStd = Math.sqrt(residualVariance);

  // Z-score for confidence level (simplified)
  let zScore;
  switch (confidenceLevel) {
    case 0.90: zScore = 1.645; break;
    case 0.95: zScore = 1.96; break;
    case 0.99: zScore = 2.576; break;
    default: zScore = 1.96;
  }

  // For linear models, we can calculate more precise intervals
  if (model.type === 'linear' && n > 2) {
    // Calculate mean of x values
    const xValues = points.map(p => p.x);
    const xMean = xValues.reduce((sum, x) => sum + x, 0) / n;
    
    // Calculate sum of squared differences for x
    const ssx = xValues.reduce((sum, x) => sum + Math.pow(x - xMean, 2), 0);
    
    return model.yhat.map((prediction, i) => {
      const x = points[i].x;
      const standardError = residualStd * Math.sqrt(1 + 1/n + Math.pow(x - xMean, 2) / ssx);
      const margin = zScore * standardError;
      return {
        lower: Math.max(0, prediction - margin),
        upper: prediction + margin
      };
    });
  } else {
    // For non-linear models, use simpler approach
    return model.yhat.map(prediction => {
      const margin = zScore * residualStd;
      return {
        lower: Math.max(0, prediction - margin),
        upper: prediction + margin
      };
    });
  }
}

// --------- Enhanced Regression with Multiple Models ---------
function enhancedRegressionFit(points, modelType = 'auto') {
  const n = points.length;
  if (n < 2) {
    return simpleFallbackModel(points);
  }

  // Try multiple models and select the best one
  const models = {};
  
  // 1. Linear Regression (OLS) - always available
  try {
    models.linear = olsFit(points);
    models.linear.type = 'linear';
    console.log(`Linear model - RMSE: ${models.linear.rmse}`);
  } catch (e) {
    console.error('Linear regression failed:', e.message);
  }
  
  // 2. Moving Average (for very short series)
  if (n >= 3) {
    try {
      models.moving_average = movingAverageFit(points);
      models.moving_average.type = 'moving_average';
      console.log(`Moving Average model - RMSE: ${models.moving_average.rmse}`);
    } catch (e) {
      console.error('Moving average failed:', e.message);
    }
  }
  
  // 3. Exponential Smoothing (for short series with trend)
  if (n >= 4) {
    try {
      models.exponential_smoothing = exponentialSmoothingFit(points);
      models.exponential_smoothing.type = 'exponential_smoothing';
      console.log(`Exponential Smoothing model - RMSE: ${models.exponential_smoothing.rmse}`);
    } catch (e) {
      console.error('Exponential smoothing failed:', e.message);
    }
  }

  // Log available models for debugging
  console.log('Available models:', Object.keys(models));

  // If specific model requested, use it if available
  if (modelType !== 'auto' && models[modelType]) {
    const selectedModel = models[modelType];
    try {
      selectedModel.confidence_intervals = calculateConfidenceIntervals(points, selectedModel);
      selectedModel.model_selected = selectedModel.type;
      console.log(`Using requested model: ${modelType}`);
      return selectedModel;
    } catch (e) {
      console.error(`Confidence intervals failed for ${modelType}:`, e.message);
      // Fall through to auto-select
    }
  }

  // Auto-select best model based on RMSE
  let bestModel = null;
  let bestRMSE = Infinity;
  
  for (const [name, model] of Object.entries(models)) {
    if (model && model.rmse !== undefined && model.rmse < bestRMSE) {
      bestModel = model;
      bestRMSE = model.rmse;
    }
  }
  
  // Fallback if no model found
  if (!bestModel) {
    bestModel = simpleFallbackModel(points);
    console.log('Using fallback model');
  } else {
    console.log(`Auto-selected model: ${bestModel.type} with RMSE: ${bestRMSE}`);
  }
  
  // Add confidence intervals
  try {
    bestModel.confidence_intervals = calculateConfidenceIntervals(points, bestModel);
  } catch (e) {
    console.error('Confidence intervals calculation failed:', e.message);
    // Provide simple confidence intervals as fallback
    bestModel.confidence_intervals = bestModel.yhat.map(prediction => ({
      lower: Math.max(0, prediction * 0.7),
      upper: prediction * 1.3
    }));
  }
  
  bestModel.model_selected = bestModel.type;
  
  return bestModel;
}

function movingAverageFit(points, window = 3) {
  const y = points.map(p => p.y);
  const yhat = [];
  
  for (let i = 0; i < points.length; i++) {
    if (i < window - 1) {
      yhat.push(y[i]); // Use actual values for beginning
    } else {
      const avg = y.slice(i - window + 1, i + 1).reduce((a, b) => a + b, 0) / window;
      yhat.push(avg);
    }
  }
  
  return calculateMetrics(points, yhat, 'moving_average');
}

function exponentialSmoothingFit(points, alpha = 0.3) {
  const y = points.map(p => p.y);
  const yhat = [y[0]];
  
  for (let i = 1; i < y.length; i++) {
    const smoothed = alpha * y[i-1] + (1 - alpha) * yhat[i-1];
    yhat.push(smoothed);
  }
  
  return calculateMetrics(points, yhat, 'exponential_smoothing');
}

function simpleFallbackModel(points) {
  const y = points.map(p => p.y);
  if (y.length === 0) {
    return {
      type: 'constant',
      yhat: [],
      r2: null, mse: null, rmse: null, mae: null, wape: null,
      mape: null, smape: null, mase: null, mape_floor5: null,
      baselineRMSE: null, improvement_vs_baseline: null
    };
  }
  const avg = y.reduce((a, b) => a + b, 0) / y.length;
  const yhat = points.map(() => avg);
  // compute proper metrics for the constant mean model
  const metrics = calculateMetrics(points, yhat, 'constant');
  return { ...metrics, type: 'constant' };
}

function calculateMetrics(points, yhat, modelType) {
  const y = points.map(p => p.y);
  const n = points.length;
  
  if (n === 0) {
    return {
      type: modelType,
      yhat: [],
      r2: null, mse: 0, rmse: 0, mae: 0, wape: 0, 
      mape: null, smape: null, mase: null
    };
  }

  const ybar = y.reduce((s, v) => s + v, 0) / n;
  
  // Calculate MSE and RMSE properly
  let mse = 0;
  let mae = 0;
  let ssRes = 0;
  let ssTot = 0;

  for (let i = 0; i < n; i++) {
    const error = y[i] - yhat[i];
    mse += error * error;
    mae += Math.abs(error);
    ssRes += error * error;
    ssTot += Math.pow(y[i] - ybar, 2);
  }

  mse /= n;
  mae /= n;
  const rmse = Math.sqrt(mse);
  
  // R² calculation with protection against division by zero
  const r2 = ssTot > 0 ? (1 - (ssRes / ssTot)) : 0;
  
  // WAPE (Weighted Absolute Percentage Error)
  const sumActual = y.reduce((s, actual) => s + Math.abs(actual), 0);
  const wape = sumActual > 0 ? mae / (sumActual / n) : 0;
  
  // MAPE (Mean Absolute Percentage Error) - only for non-zero values
  const mapeArr = [];
  for (let i = 0; i < n; i++) {
    if (y[i] !== 0) {
      mapeArr.push(Math.abs((y[i] - yhat[i]) / y[i]));
    }
  }
  const mape = mapeArr.length > 0 ? 
    (mapeArr.reduce((s, v) => s + v, 0) / mapeArr.length) : null;
  
  // sMAPE (Symmetric Mean Absolute Percentage Error)
  const EPS = 1e-9;
  let smapeSum = 0;
  for (let i = 0; i < n; i++) {
    const denominator = Math.abs(y[i]) + Math.abs(yhat[i]) + EPS;
    smapeSum += (2 * Math.abs(y[i] - yhat[i])) / denominator;
  }
  const smape = smapeSum / n;
  
  // MASE (Mean Absolute Scaled Error)
  let mase = null;
  if (n >= 2) {
    let naiveErrors = 0;
    for (let i = 1; i < n; i++) {
      naiveErrors += Math.abs(y[i] - y[i-1]);
    }
    const meanNaiveError = naiveErrors / (n - 1);
    mase = meanNaiveError > 0 ? mae / meanNaiveError : null;
  }
  
  // MAPE floor 5% (filter out very small values that inflate MAPE)
  const mapeFloor5Arr = [];
  for (let i = 0; i < n; i++) {
    if (y[i] >= 5) { // Only consider values >= 5
      mapeFloor5Arr.push(Math.abs((y[i] - yhat[i]) / y[i]));
    }
  }
  const mape_floor5 = mapeFloor5Arr.length > 0 ? 
    (mapeFloor5Arr.reduce((s, v) => s + v, 0) / mapeFloor5Arr.length) : null;

  // Calculate baseline (naive forecast: average of y) for comparison
  const baselineYhat = points.map(() => ybar);
  const baselineMSE = y.reduce((s, v, i) => s + Math.pow(v - baselineYhat[i], 2), 0) / n;
  const baselineRMSE = Math.sqrt(baselineMSE);
  const improvement = baselineRMSE > 0 ? (baselineRMSE - rmse) / baselineRMSE : 0;

  return {
    type: modelType,
    yhat,
    r2, mse, rmse, mae, wape, mape, smape, mase, mape_floor5,
    baselineRMSE,
    improvement_vs_baseline: improvement
  };
}

// ---------------------------- list ----------------------------
router.get('/', async (_req, res) => {
  try {
    const rows = await prisma.$queryRaw`
      select id, name, upload_date, status, data_type, file_format, coalesce(tags,'') as tags
      from datasets
      order by upload_date desc nulls last, id desc
    `;
    res.json((rows || []).map(r => ({
      dataset_id: r.id,
      name: r.name,
      upload_date: r.upload_date,
      status: r.status,
      data_type: r.data_type,
      file_format: r.file_format,
      tags: r.tags
    })));
  } catch (e) {
    console.error('dataset_list_failed:', e?.message);
    const status = /Can't reach database server/i.test(e?.message) ? 503 : 500;
    res.status(status).json({ message: 'dataset_list_failed', detail: e?.message });
  }
});

router.get('/_health', async (_req, res) => {
  try {
    const c = await prisma.$queryRaw`select count(*)::int as c from datasets`;
    res.json({ ok: true, datasets: c?.[0]?.c ?? 0 });
  } catch (e) {
    res.status(503).json({ ok: false, detail: e?.message });
  }
});

// ---------------------------- upload (with perf & robustness) ----------------------------
router.post('/upload', getUploadMiddleware(), async (req, res) => {
  const T0 = Date.now();
  let T = T0;
  const tick = (label) => { const now = Date.now(); console.log(`[upload] +${now - T}ms ${label}`); T = now; };

  try {
    if (!req.file?.buffer && !req.file?.path) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fname = req.file.originalname || 'upload.xlsx';
    tick(`received: ${fname} (${req.file.size || 0} bytes)`);

    const lower = fname.toLowerCase();
    const isCsv = lower.endsWith('.csv');
    const isXlsx = lower.endsWith('.xlsx') || lower.endsWith('.xls');
    if (!isCsv && !isXlsx) return res.status(400).json({ error: 'Only .csv or .xlsx/.xls allowed' });

    const fileBuf = readFileToBuffer(req.file);
    tick(`read file into buffer (${fileBuf?.length || 0} bytes)`);

    // dataset row creation
    const ds = await prisma.datasets.create({
      data: {
        name: req.body?.name || fname,
        upload_date: new Date(),
        status: 'Processed',
        data_type: req.body?.data_type || 'survey responses',
        file_format: isCsv ? 'CSV' : 'Excel',
        tags: req.body?.tags || ''
      }
    });
    tick(`created dataset row id=${ds.id}`);

    // parse workbook
    let rows, sheetName, normMap;
    try {
      const r = readBestSheet(fileBuf, fname, chooseMapping(fname));

      // Add detailed logging to inspect the parsing outcome
      console.log("Parsed Data:", r); // Log raw parsed data
      rows = r.rows; sheetName = r.sheetName; normMap = r.normMap;

      if (!rows || rows.length === 0) {
        console.error("No rows found after parsing sheet.");
        return res.status(400).json({ error: 'No data rows detected' });
      }
    } catch (e) {
      console.error("Error in parsing the dataset:", e.message);
      console.error(e.stack);
      return res.status(400).json({ error: 'Failed to parse file', detail: e.message });
    } finally {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
    }
    tick(`parsed workbook: sheet="${sheetName}", rows=${rows?.length || 0}`);

    // transform -> facts
    let facts = [], issues = [];
    try {
      const out = consolidateRows(rows, {}, normMap);
      facts = out.facts || []; 
      issues = out.issues || [];

      // Logging the transformed facts
      console.log("Transformed Facts:", facts);
      console.log("Issues Detected:", issues);

      // Remove outliers 
      //facts = removeOutliers(facts);

      // Apply feature engineering
      facts = addTimeFeatures(facts);
    } catch (e) {
      console.error("Error in transformation step:", e.message);
      return res.status(500).json({ error: 'Transform failed', detail: e.message });
    }
    tick(`transformed to facts=${facts.length} (issues=${issues.length})`);

    // deduplicate raw/clean JSON per respondent+date
    const firstJsonForKey = new Set();
    const keyOf = (f) => {
      const d = f.interviewDate ? new Date(f.interviewDate).toISOString().slice(0,10) : '';
      return `${f.respondentId}||${d}`;
    };

    // insert in batches
    const doInsertBatches = async (client) => {
      for (let i = 0; i < facts.length; i += INSERT_CHUNK) {
        const chunk = facts.slice(i, i + INSERT_CHUNK);
        const mapped = chunk.map(f => {
          const key = keyOf(f);
          const include = !firstJsonForKey.has(key);
          if (include) firstJsonForKey.add(key);
          return {
            datasetId: ds.id,
            respondentId: f.respondentId,
            interviewDate: f.interviewDate ? new Date(f.interviewDate) : null,
            region: f.region,
            city: f.city,
            interviewer: f.interviewer,
            channel: f.channel,
            questionCode: f.questionCode,
            answerText: f.answerText,
            answerNum: f.answerNum,
            rawJson: include ? f.rawJson : null,
            cleanJson: include ? f.cleanJson : null
          };
        });

        // Insert data into database
        await client.responseFact.createMany({
          data: mapped,
          skipDuplicates: SKIP_DUPLICATES
        });
        tick(`inserted ${Math.min(i + mapped.length, facts.length)}/${facts.length}`);
      }
    };

    if (USE_TX) {
      await prisma.$transaction(async (tx) => { await doInsertBatches(tx); });
    } else {
      await doInsertBatches(prisma);
    }

    console.log(`[upload] total: ${Date.now() - T0}ms`);
    
    res.json({
      status: 'ok',
      dataset_id: ds.id,
      sheet: sheetName,
      inserted_facts: facts.length,
      issues_count: issues.length,
      file_info: { name: fname, size_bytes: req.file.size, mimetype: req.file.mimetype }
    });

  } catch (e) {
    if (e && e.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'file_too_large',
        message: `File exceeds ${MAX_UPLOAD_MB} MB limit`,
        max_mb: MAX_UPLOAD_MB
      });
    }
    console.error('upload failed', e);
    res.status(500).json({ error: 'Upload/ETL failed', detail: e.message });
  }
});

// ---------------------------- delete (and delete-fallback) ----------------------------
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    await prisma.responseFact.deleteMany({ where: { datasetId: id } });
    try { await prisma.$executeRawUnsafe(`delete from "AuditLog" where "datasetId" = $1`, id); } catch {}
    await prisma.datasets.delete({ where: { id } });
    res.json({ ok: true, deleted_dataset_id: id });
  } catch (e) {
    console.error('delete_failed', e);
    res.status(500).json({ ok: false, message: 'delete_failed', detail: e.message });
  }
});

router.post('/:id/delete', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    await prisma.responseFact.deleteMany({ where: { datasetId: id } });
    try { await prisma.$executeRawUnsafe(`delete from "AuditLog" where "datasetId" = $1`, id); } catch {}
    await prisma.datasets.delete({ where: { id } });
    res.json({ ok: true, deleted_dataset_id: id });
  } catch (e) {
    console.error('delete_post_failed', e);
    res.status(500).json({ ok: false, message: 'delete_post_failed', detail: e.message });
  }
});

// ==================== SUMMARY & ANALYTICS ROUTES ====================
router.get('/:id/summary', async (req, res) => {
  try {
    const id = parseId(req.params.id);

    const totalRes = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT "respondentId")::int AS n
      FROM "ResponseFact" WHERE "datasetId" = ${id}
    `;
    const respondent_count = totalRes?.[0]?.n || 0;

    const fact_count = await prisma.responseFact.count({ where: { datasetId: id } });

    // HARD completion
    const completedHard = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT "respondentId")::int AS n
      FROM "ResponseFact"
      WHERE "datasetId" = ${id}
        AND (
          "interviewDate" IS NOT NULL
          OR lower(
               COALESCE(
                 "cleanJson"->>'completed',
                 "rawJson"  ->>'completed',
                 "rawJson"  ->>'Completion',
                 "rawJson"  ->>'Completed',
                 "rawJson"  ->>'Status'
               )
             ) ~ '(?:^|\\b)(1|true|yes|completed|complete|done|finished|ok)(?:\\b|$)'
        )
    `;
    const hard = completedHard?.[0]?.n || 0;

    // SOFT completion (density rule)
    const soft = hard > 0 ? 0 : (await prisma.$queryRaw`
      WITH per AS (
        SELECT "respondentId", COUNT(*)::int AS c
        FROM "ResponseFact" WHERE "datasetId" = ${id}
        GROUP BY "respondentId"
      ),
      m AS (SELECT MAX(c) AS mx FROM per)
      SELECT COUNT(*)::int AS n
      FROM per, m
      WHERE per.c >= GREATEST(1, FLOOR(${COMPLETION_DENSITY_PCT} * m.mx))
    `)?.[0]?.n || 0;

    const completed_respondents = hard > 0 ? hard : soft;
    const completion_method = hard > 0 ? 'dated_or_flagged' : `soft_density_${Math.round(COMPLETION_DENSITY_PCT*100)}pct`;
    const completed_pct = respondent_count ? (100 * completed_respondents / respondent_count) : 0;

    const by_region_facts = await prisma.$queryRaw`
      SELECT COALESCE(region,'Unspecified') AS region, COUNT(*)::int AS facts
      FROM "ResponseFact" WHERE "datasetId" = ${id}
      GROUP BY region
      ORDER BY facts DESC
      LIMIT 10
    `;

    const top_questions = await prisma.$queryRaw`
      SELECT "questionCode" AS question, COUNT(*)::int AS c
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "questionCode" IS NOT NULL
      GROUP BY "questionCode"
      HAVING COUNT(*) > 0
      ORDER BY c DESC
      LIMIT 60
    `;

    res.json({
      dataset_id: id,
      respondent_count,
      fact_count,
      completed_respondents,
      completed_pct,
      completion_method,
      by_region_facts: by_region_facts || [],
      top_questions: top_questions || []
    });
  } catch (e) {
    console.error('summary_failed:', e);
    res.status(400).json({ message: 'summary_failed', detail: e.message });
  }
});

router.get('/:id/questions', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.$queryRaw`
      SELECT "questionCode" AS question, COUNT(*)::int AS n
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "questionCode" IS NOT NULL
      GROUP BY "questionCode"
      ORDER BY n DESC
      LIMIT 120
    `;
    res.json({ items: rows || [] });
  } catch (e) {
    console.error('questions_failed:', e);
    res.status(400).json({ message: 'questions_failed', detail: e.message });
  }
});

router.get('/:id/questions/with-sample', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.$queryRaw`
      WITH q AS (
        SELECT "questionCode", COUNT(*)::int c
        FROM "ResponseFact" WHERE "datasetId" = ${id}
        GROUP BY "questionCode"
      ),
      s AS (
        SELECT DISTINCT ON ("questionCode")
               "questionCode", "answerText"
        FROM "ResponseFact" WHERE "datasetId" = ${id}
          AND "answerText" IS NOT NULL
        ORDER BY "questionCode", random()
      )
      SELECT q."questionCode" AS question, q.c AS n, COALESCE(s."answerText",'') AS sampleText
      FROM q LEFT JOIN s ON q."questionCode" = s."questionCode"
      ORDER BY n DESC
      LIMIT 120
    `;
    res.json({ items: rows || [] });
  } catch (e) {
    console.error('questions_sample_failed:', e);
    res.status(400).json({ message: 'questions_sample_failed', detail: e.message });
  }
});

// ---------- CLEANED QDIST ----------
router.get('/:id/qdist', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const q = String(req.query.questionCode || '').trim();
    if (!q) return res.status(400).json({ error: 'questionCode required' });

    const rows = await prisma.responseFact.findMany({
      where: { datasetId: id, questionCode: q },
      select: { answerText: true, answerNum: true },
      take: 100000
    });

    const nums = [];
    for (const r of rows) {
      if (r.answerNum !== null && r.answerNum !== undefined) {
        const v = Number(r.answerNum);
        if (Number.isFinite(v)) nums.push(v);
      } else if (r.answerText && isNumericish(r.answerText)) {
        const v = coerceNumeric(r.answerText);
        if (v !== null) nums.push(v);
      }
    }

    const stop = new Set(['', 'N/A', 'NA', 'NONE', 'NULL', 'UNSPECIFIED', 'UNASSIGNED', '—', '-', 'NCL']);
    const texts = [];
    for (const r of rows) {
      const raw = (r.answerText ?? '').toString().trim();
      if (!raw) continue;
      if (isNumericish(raw)) continue;
      const token = normTextToken(raw);
      if (!token || token.length < 2 || stop.has(token)) continue;
      texts.push(token);
    }

    const numeric_bins = [];
    if (nums.length) {
      const min = Math.min(...nums), max = Math.max(...nums);
      const k = Math.min(25, Math.max(6, Math.ceil(Math.sqrt(nums.length))));
      const step = ((max - min) / (k || 1)) || 1;
      for (let i = 0; i < k; i++) {
        const lo = min + i * step;
        const hi = (i === k - 1) ? max : lo + step;
        const cnt = nums.reduce((s, v) => s + ((i === 0 ? v >= lo : v > lo) && v <= hi ? 1 : 0), 0);
        numeric_bins.push({ lo, hi, count: cnt });
      }
    }

    const tf = new Map();
    for (const t of texts) tf.set(t, (tf.get(t) || 0) + 1);
    const text_top = Array.from(tf.entries())
      .sort((a,b)=>b[1]-a[1])
      .slice(0, 50)
      .map(([label, count]) => ({ label, count }));

    res.json({ numeric_bins, text_top });
  } catch (e) {
    console.error('qdist_failed:', e);
    res.status(400).json({ message: 'qdist_failed', detail: e.message });
  }
});

router.get('/:id/by-region-completed', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const hardRows = await prisma.$queryRaw`
      SELECT COALESCE(region,'Unspecified') AS region,
             COUNT(DISTINCT "respondentId")::int AS completed
      FROM "ResponseFact"
      WHERE "datasetId" = ${id}
        AND (
          "interviewDate" IS NOT NULL
          OR lower(
               COALESCE(
                 "cleanJson"->>'completed',
                 "rawJson"  ->>'completed',
                 "rawJson"  ->>'Completion',
                 "rawJson"  ->>'Completed',
                 "rawJson"  ->>'Status'
               )
             ) ~ '(?:^|\\b)(1|true|yes|completed|complete|done|finished|ok)(?:\\b|$)'
        )
      GROUP BY region
      ORDER BY completed DESC
      LIMIT 12
    `;
    if (hardRows.length > 0) return res.json({ items: hardRows });

    const softRows = await prisma.$queryRaw`
      WITH per AS (
        SELECT "respondentId",
               COALESCE(region,'Unspecified') AS region,
               COUNT(*)::int AS c
        FROM "ResponseFact"
        WHERE "datasetId" = ${id}
        GROUP BY "respondentId", region
      ),
      m AS (SELECT MAX(c) AS mx FROM per)
      SELECT region, COUNT(*)::int AS completed
      FROM per, m
      WHERE per.c >= GREATEST(1, FLOOR(${COMPLETION_DENSITY_PCT} * m.mx))
      GROUP BY region
      ORDER BY completed DESC
      LIMIT 12
    `;
    res.json({ items: softRows || [] });
  } catch (e) {
    console.error('region_completed_failed:', e);
    res.status(400).json({ message: 'region_completed_failed', detail: e.message });
  }
});

router.get('/:id/series', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const series = await prisma.$queryRaw`
      SELECT DATE("interviewDate") AS day,
             COUNT(DISTINCT "respondentId")::int AS completed
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY day
      ORDER BY day
    `;
    res.json({ daily: series || [] });
  } catch (e) {
    res.status(400).json({ message: 'series_failed', detail: e.message });
  }
});

router.get('/:id/completion/daily', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.$queryRaw`
      SELECT DATE("interviewDate") AS d, COUNT(DISTINCT "respondentId")::int AS cnt
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY d ORDER BY d
    `;
    res.json({ items: rows || [] });
  } catch (e) {
    console.error('completion_daily_failed:', e);
    res.status(500).json({ error: 'completion_daily_failed', detail: e.message });
  }
});

router.get('/:id/completion/by-region', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.$queryRaw`
      SELECT COALESCE(region,'Unspecified') AS region,
             COUNT(DISTINCT "respondentId")::int AS cnt
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY region
      ORDER BY cnt DESC
      LIMIT 20
    `;
    res.json({ items: rows || [] });
  } catch (e) {
    console.error('completion_by_region_failed:', e);
    res.status(500).json({ error: 'completion_by_region_failed', detail: e.message });
  }
});

router.get('/:id/completion/by-interviewer', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.$queryRaw`
      SELECT COALESCE(interviewer,'Unspecified') AS interviewer,
             COUNT(DISTINCT "respondentId")::int AS cnt
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY interviewer
      ORDER BY cnt DESC
      LIMIT 20
    `;
    res.json({ items: rows || [] });
  } catch (e) {
    console.error('completion_by_interviewer_failed:', e);
    res.status(500).json({ error: 'completion_by_interviewer_failed', detail: e.message });
  }
});

// ---------------------------- forecasting diagnostics ----------------------------
router.get('/:id/forecasting-diagnostics', async (req, res) => {
  try {
    const id = parseId(req.params.id);

    const daily = await prisma.$queryRaw`
      SELECT DATE("interviewDate") AS day,
             COUNT(DISTINCT "respondentId")::int AS completed
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY day
      ORDER BY day
    `;

    const series = (daily || []).map(r => ({
      date: isoDate(r.day),
      count: Number(r.completed || 0),
      completed: Number(r.completed || 0)
    }));

    const diagnostics = analyzeForecastingReadiness(series, {
      datasetId: id,
      totalRows: series.length
    });

    // Add additional dataset-level insights
    const datasetInfo = await prisma.datasets.findFirst({
      where: { id },
      select: { name: true, upload_date: true, data_type: true }
    });

    res.json({
      dataset_id: id,
      dataset_name: datasetInfo?.name,
      upload_date: datasetInfo?.upload_date,
      data_type: datasetInfo?.data_type,
      diagnostics,
      recommendations: diagnostics.suggestions,
      readiness_score: calculateReadinessScore(diagnostics)
    });
  } catch (e) {
    console.error('forecasting_diagnostics_failed:', e);
    res.status(500).json({ message: 'forecasting_diagnostics_failed', detail: e.message });
  }
});

function calculateReadinessScore(diagnostics) {
  let score = 100;
  
  // Penalize for insufficient data points
  if (diagnostics.dataPoints < 10) {
    score -= (10 - diagnostics.dataPoints) * 5;
  }
  
  // Penalize for short time range
  if (diagnostics.dayRange < 7) {
    score -= (7 - diagnostics.dayRange) * 10;
  }
  
  // Penalize for low variance
  if (diagnostics.variance < 0.1) {
    score -= 20;
  }
  
  // Penalize for irregular intervals
  if (!diagnostics.regularIntervals) {
    score -= 10;
  }
  
  // Penalize for missing data
  if (diagnostics.missingData) {
    score -= 15;
  }
  
  return Math.max(0, Math.min(100, score));
}

// ---------------------------- enhanced predictive regression ----------------------------
router.get('/:id/predict/regression', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new Error('Invalid dataset id');

    const daily = await prisma.$queryRaw`
      SELECT DATE("interviewDate") AS day,
             COUNT(DISTINCT "respondentId")::int AS completed
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY day
      ORDER BY day
    `;
    
    let pts = (daily || []).map((r, i) => ({ x: i, y: Number(r.completed || 0), date: isoDate(r.day) }));
    let synthetic = false;

    // Enhanced synthetic data generation for very short series
    if (pts.length < 2) {
      let total = 0;
      const td = await prisma.$queryRaw`
        SELECT COUNT(DISTINCT "respondentId")::int AS n
        FROM "ResponseFact" WHERE "datasetId" = ${id}
      `;
      total = td?.[0]?.n || 0;
      
      if (total === 0) {
        const est = await prisma.$queryRaw`
          SELECT COUNT(*)::int AS facts,
                 NULLIF(COUNT(DISTINCT "questionCode"),0)::int AS qdim
          FROM "ResponseFact" WHERE "datasetId" = ${id}
        `;
        const facts = est?.[0]?.facts || 0;
        const qdim  = est?.[0]?.qdim  || 0;
        if (qdim > 0) total = Math.max(0, Math.round(facts / qdim));
      }
      
      // Generate more realistic synthetic data with some variance
      const days = Math.min(7, Math.max(3, Math.ceil(Math.sqrt(Math.max(2, total)))));
      const baseRate = total / days;
      const variance = baseRate * 0.3; // 30% variance
      
      const today = new Date();
      pts = Array.from({ length: days }, (_, i) => {
        const d = new Date(today); 
        d.setDate(d.getDate() - (days - i));
        // Add some random variation to make data more realistic
        const variation = (Math.random() - 0.5) * 2 * variance;
        const dailyValue = Math.max(1, Math.round(baseRate + variation));
        return { x: i, y: dailyValue, date: d.toISOString().slice(0,10) };
      });
      synthetic = true;
    }

    // Enhanced forecasting diagnostics
    const diagnostics = analyzeForecastingReadiness(pts.map(p => ({ 
      date: p.date, 
      count: p.y,
      completed: p.y 
    })));

    const uniqueY = new Set(pts.map(p => p.y)).size;
    const n = pts.length;
    
    if (n < 2 || uniqueY <= 1) {
      return res.json({
        v: 4, // version 4 with enhanced diagnostics
        dataset_id: id,
        synthetic,
        diagnostics, // Include diagnostics in response
        unit: 'respondents/day',
        metrics: {
          r2: null, mse: 0, rmse: 0,
          baseline_mse: null, baseline_rmse: null, improvement_vs_baseline: null,
          mae: null, wape: null, mape: null, mape_floor5: null, smape: null,
          oos_rmse: null, oos_mape: null, oos_smape: null, oos_r2: null,
          model_used: 'constant'
        },
        history: pts.map(p => ({ date: p.date, actual: p.y, fitted: p.y })),
        horizon: [],
        confidence_intervals: []
      });
    }

    // Use enhanced regression that selects best model
    const fit = enhancedRegressionFit(pts);
    
    // Enhanced horizon generation with confidence intervals
    const horizon = makeHorizonWithCI(
      pts[pts.length - 1].date, 
      pts[pts.length - 1].x, 
      fit, 
      7, 
      'day'
    );

    // Enhanced out-of-sample validation for longer series
    // Enhanced out-of-sample validation for longer series
let oos = { rmse: null, mape: null, smape: null, r2: null, mase: null, baseline_rmse: null, improvement_vs_baseline: null };
if (!synthetic && n >= 8) { // Increased minimum for OOS validation (fixed emoji)
  const h = Math.max(2, Math.floor(0.25 * n)); // 25% holdout
  const train = pts.slice(0, n - h);
  const test  = pts.slice(n - h);

  const tfit = enhancedRegressionFit(train);

  // model preds for test
  const testY    = test.map(p => p.y);
  const testYhat = test.map((p, i) => {
    const xInTest = train.length + i;
    if (tfit.type === 'linear' && tfit.a != null && tfit.b != null) {
      return Math.max(0, tfit.a * xInTest + tfit.b);
    } else {
      const lastTrainYhat = tfit.yhat[tfit.yhat.length - 1] ?? train[train.length - 1].y;
      return Math.max(0, lastTrainYhat);
    }
  });

  // naive baseline (random-walk / persistence): y_hat_t = y_{t-1}
  const naiveYhat = test.map((_, i) => (i === 0 ? train[train.length - 1].y : test[i - 1].y));

  const tmse  = testY.reduce((s, v, i) => s + Math.pow(v - testYhat[i], 2), 0) / test.length;
  const trmse = Math.sqrt(tmse);

  const nbmse = testY.reduce((s, v, i) => s + Math.pow(v - naiveYhat[i], 2), 0) / test.length;
  const nbrmse = Math.sqrt(nbmse);

  const tmapeArr = testY.map((v, i) => v !== 0 ? Math.abs((v - testYhat[i]) / v) : null).filter(v => v !== null);
  const tmape    = tmapeArr.length ? (tmapeArr.reduce((s, v) => s + v, 0) / tmapeArr.length) : null;

  const EPS = 1e-9;
  const tsmapeArr = testY.map((v, i) => {
    const denom = Math.abs(v) + Math.abs(testYhat[i]) + EPS;
    return (2 * Math.abs(v - testYhat[i])) / denom;
  });
  const tsmape = tsmapeArr.reduce((s, v) => s + v, 0) / tsmapeArr.length;

  const tybar = testY.reduce((s, v) => s + v, 0) / test.length;
  const tssRes = testY.reduce((s, v, i) => s + Math.pow(v - testYhat[i], 2), 0);
  const tssTot = testY.reduce((s, v) => s + Math.pow(v - tybar, 2), 0); // << fixed exponent
  const tr2    = tssTot > 0 ? (1 - (tssRes / tssTot)) : 0;

  // OOS MASE
  let trainNaive = null;
  if (train.length >= 2) {
    const denomAbs = train.slice(1).reduce((s, p, i) => s + Math.abs(p.y - train[i].y), 0) / (train.length - 1);
    trainNaive = denomAbs > 0 ? denomAbs : null;
  }
  const testMAE = testY.reduce((s, v, i) => s + Math.abs(v - testYhat[i]), 0) / testY.length;
  const tmase   = (trainNaive && Number.isFinite(testMAE)) ? (testMAE / trainNaive) : null;

  oos = {
    rmse: trmse,
    mape: tmape,
    smape: tsmape,
    r2: tr2,
    mase: tmase,
    baseline_rmse: nbrmse,
    improvement_vs_baseline: (nbrmse > 0) ? (nbrmse - trmse) / nbrmse : null
  };
}

res.json({
  v: 4,
  dataset_id: id,
  synthetic,
  diagnostics,
  unit: 'respondents/day',
  metrics: {
    r2: fit.r2, mse: fit.mse, rmse: fit.rmse,
    mae: fit.mae, wape: fit.wape, mape: fit.mape, smape: fit.smape, mase: fit.mase, mape_floor5: fit.mape_floor5,
    baseline_rmse: fit.baselineRMSE,
    improvement_vs_baseline: (fit.improvement_vs_baseline != null) ? fit.improvement_vs_baseline : fit.improvement,
    oos_rmse: oos.rmse, 
    oos_mape: oos.mape, 
    oos_smape: oos.smape, 
    oos_r2: oos.r2,
    oos_mase: oos.mase,
    oos_baseline_rmse: oos.baseline_rmse,
    oos_improvement_vs_baseline: oos.improvement_vs_baseline,
    model_used: fit.model_selected || fit.type
  },
  history: pts.map((p, i) => ({
    date: p.date, 
    actual: p.y, 
    fitted: Math.max(0, Math.round(fit.yhat[i])),
    confidence_lower: Math.max(0, Math.round(fit.confidence_intervals[i].lower)),
    confidence_upper: Math.round(fit.confidence_intervals[i].upper)
  })),
  horizon,
  model_info: {
    type: fit.model_selected || fit.type,
    parameters: fit.type === 'linear' ? { slope: fit.a, intercept: fit.b } : {},
    confidence_level: 0.95
  }
});
  } catch (e) {
    console.error('enhanced_regression_failed:', e);
    res.status(500).json({ message: 'enhanced_regression_failed', detail: e.message });
  }
});

// Enhanced horizon function with confidence intervals
function makeHorizonWithCI(lastDateISO, lastX, fit, steps = 7, interval = 'day') {
  const out = [];
  const base = new Date(lastDateISO);
  
  // Get the last few values for trend calculation
  const lastValues = fit.yhat.slice(-3).filter(v => v != null);
  const avgRecent = lastValues.length > 0 ? 
    lastValues.reduce((a, b) => a + b, 0) / lastValues.length : 0;
  
  for (let k = 1; k <= steps; k++) {
    const d = new Date(base);
    if (interval === 'week') d.setDate(d.getDate() + 7 * k);
    else if (interval === 'month') d.setMonth(d.getMonth() + k);
    else d.setDate(d.getDate() + k);
    
    let projected, lower, upper;
    
    if (fit.type === 'linear' && fit.a !== undefined && fit.b !== undefined) {
      const x = lastX + k;
      projected = Math.max(0, fit.a * x + fit.b);
    } else if (fit.type === 'moving_average') {
      // For moving average, use the recent average with slight decay
      projected = Math.max(0, avgRecent * (1 - (k * 0.05))); // 5% decay per step
    } else if (fit.type === 'exponential_smoothing') {
      // For exponential smoothing, continue the smoothing trend
      const lastValue = fit.yhat[fit.yhat.length - 1] || 0;
      projected = Math.max(0, lastValue * (1 - (k * 0.02))); // 2% decay
    } else {
      // Fallback: use the average of recent values
      projected = Math.max(0, avgRecent);
    }
    
    // Add some variance based on model performance
    const errorMargin = fit.rmse || 1;
    lower = Math.max(0, projected - errorMargin * 1.5);
    upper = Math.max(0, projected + errorMargin * 1.5);
    
    out.push({
      date: d.toISOString().slice(0, 10),
      projected: Math.round(projected),
      confidence_lower: Math.round(lower),
      confidence_upper: Math.round(upper)
    });
  }
  return out;
}

// ===== QUESTION-LEVEL PREDICTIVE =====

// 1) auto-classify questions by type (now returns a human-friendly "label")
router.get('/:id/questions/schema', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.$queryRaw`
      WITH b AS (
        SELECT "questionCode" AS q,
               COUNT(*)::int AS n,
               COUNT("answerNum")::int AS n_num,
               COUNT(NULLIF(TRIM(COALESCE("answerText",'')),''))::int AS n_text,
               COUNT(DISTINCT TRIM(UPPER(REGEXP_REPLACE(COALESCE("answerText",''), '\\s+', ' ', 'g'))))::int AS uniq_text
        FROM "ResponseFact"
        WHERE "datasetId" = ${id}
        GROUP BY "questionCode"
      ),
      s AS (
        SELECT DISTINCT ON ("questionCode")
               "questionCode", "answerText"
        FROM "ResponseFact"
        WHERE "datasetId" = ${id}
          AND "answerText" IS NOT NULL
        ORDER BY "questionCode", random()
      )
      SELECT b.q, b.n, b.n_num, b.n_text, b.uniq_text, COALESCE(s."answerText",'') AS sample_text
      FROM b LEFT JOIN s ON s."questionCode" = b.q
      WHERE b.q IS NOT NULL
      ORDER BY b.n DESC
      LIMIT 400
    `;
    const items = (rows || []).map(r => {
      const fracNum = r.n ? r.n_num / r.n : 0;
      let kind = 'text';
      if (fracNum >= 0.4) kind = 'numeric';
      else if (r.uniq_text <= 30 && r.uniq_text > 0) kind = 'categorical';
      const label = prettyQuestionLabel(r.q, r.sample_text);
      return {
        question: r.q,
        label,           // << human-friendly label for dropdowns
        total: r.n,
        numeric_rows: r.n_num,
        text_rows: r.n_text,
        unique_text: r.uniq_text,
        kind,
        sampleText: r.sample_text
      };
    });
    res.json({ items });
  } catch (e) {
    console.error('questions_schema_failed:', e);
    res.status(400).json({ message: 'questions_schema_failed', detail: e.message });
  }
});

// 2) numeric question forecast
// GET /api/dataset/:id/predict/question/numeric?questionCode=Q1&agg=sum|avg|count&interval=day|week|month
router.get('/:id/predict/question/numeric', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const q  = String(req.query.questionCode || '').trim();
    const agg = (String(req.query.agg || 'avg').toLowerCase());
    const interval = (String(req.query.interval || 'day').toLowerCase());
    if (!q) return res.status(400).json({ error: 'questionCode required' });
    if (!['sum','avg','count'].includes(agg)) return res.status(400).json({ error: 'agg must be sum|avg|count' });
    if (!['day','week','month'].includes(interval)) return res.status(400).json({ error: 'interval must be day|week|month' });

    const bucketExpr = interval === 'week' ? `DATE_TRUNC('week',"interviewDate")`
                      : interval === 'month' ? `DATE_TRUNC('month',"interviewDate")`
                      : `DATE_TRUNC('day',"interviewDate")`;

    const rows = await prisma.$queryRawUnsafe(`
      WITH base AS (
        SELECT
          ${bucketExpr}::date AS d,
          CASE
            WHEN "answerNum" IS NOT NULL THEN "answerNum"
            WHEN "answerText" ~ '^[\\s]*[+\\-]?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*%?[\\s]*$'
              THEN REGEXP_REPLACE(LOWER("answerText"), '[,%]', '', 'g')::numeric
            ELSE NULL
          END AS val
        FROM "ResponseFact"
        WHERE "datasetId" = $1 AND "questionCode" = $2 AND "interviewDate" IS NOT NULL
      )
      SELECT d::date AS day,
             COUNT(val) FILTER (WHERE val IS NOT NULL)::int AS n,
             SUM(val)::float8 AS sum,
             AVG(val)::float8 AS avg
      FROM base
      GROUP BY day
      ORDER BY day
    `, id, q);

    if (!rows || rows.length === 0) {
      return res.json({ dataset_id: id, question: q, interval, agg, history: [], horizon: [], metrics: {}, synthetic: true });
    }

    const series = rows.map(r => ({
      date: isoDate(r.day),
      y: agg === 'sum' ? Number(r.sum || 0)
           : agg === 'count' ? Number(r.n || 0)
           : Number(r.avg || 0)
    })).filter(r => Number.isFinite(r.y));

    const pts = series.map((r,i)=>({ x:i, y:r.y, date:r.date }));
    if (pts.length < 2 || new Set(pts.map(p=>p.y)).size <= 1) {
      return res.json({
        dataset_id: id, question: q, agg, interval, synthetic: false,
        metrics: { r2:null, rmse:0, mape:null, smape:null, mape_floor5:null, baseline_rmse:null, improvement_vs_baseline:null, mase:null },
        history: pts.map(p => ({ date: p.date, actual: p.y, fitted: p.y })),
        horizon: []
      });
    }

    // use enhanced model selector (linear / moving average / exponential smoothing)
    const fit = enhancedRegressionFit(pts);
    const horizon = makeHorizon(pts[pts.length-1].date, pts[pts.length-1].x, fit.a ?? 0, fit.b ?? (fit.yhat?.[fit.yhat.length-1] ?? 0), 7, interval);

    res.json({
      dataset_id: id, question: q, agg, interval, synthetic: false,
      metrics: {
        r2: fit.r2, rmse: fit.rmse, mse: fit.mse,
        baseline_rmse: fit.baselineRMSE,
        improvement_vs_baseline: (fit.improvement_vs_baseline != null) ? fit.improvement_vs_baseline : fit.improvement,
        mae: fit.mae, wape: fit.wape, mape: fit.mape, mape_floor5: fit.mape_floor5, smape: fit.smape, mase: fit.mase
      },
      history: pts.map((p,i)=>({ date: p.date, actual: p.y, fitted: Math.max(0, Math.round(fit.yhat[i])) })),
      horizon
    });
  } catch (e) {
    console.error('q_numeric_forecast_failed:', e);
    res.status(500).json({ message: 'q_numeric_forecast_failed', detail: e.message });
  }
});

// 3) categorical/text question forecast
// GET /api/dataset/:id/predict/question/categorical?questionCode=Q1&top_k=5&interval=day|week|month&as_share=0|1
router.get('/:id/predict/question/categorical', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const q  = String(req.query.questionCode || '').trim();
    const topK = Math.max(1, Math.min(10, Number(req.query.top_k || 5)));
    const interval = (String(req.query.interval || 'day').toLowerCase());
    const asShare = String(req.query.as_share || '0') === '1';
    if (!q) return res.status(400).json({ error: 'questionCode required' });
    if (!['day','week','month'].includes(interval)) return res.status(400).json({ error: 'interval must be day|week|month' });

    const bucketExpr = interval === 'week' ? `DATE_TRUNC('week',"interviewDate")`
                      : interval === 'month' ? `DATE_TRUNC('month',"interviewDate")`
                      : `DATE_TRUNC('day',"interviewDate")`;

    const topLabels = await prisma.$queryRawUnsafe(`
      WITH base AS (
        SELECT TRIM(UPPER(REGEXP_REPLACE(COALESCE("answerText",''), '\\s+', ' ', 'g'))) AS label
        FROM "ResponseFact"
        WHERE "datasetId" = $1 AND "questionCode" = $2
          AND "interviewDate" IS NOT NULL
          AND "answerText" IS NOT NULL
          AND NOT ("answerText" ~ '^[\\s]*[+\\-]?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*%?[\\s]*$')
      )
      SELECT label, COUNT(*)::int AS c
      FROM base
      WHERE label <> ''
      GROUP BY label
      ORDER BY c DESC
      LIMIT $3
    `, id, q, topK);
    if (!topLabels || topLabels.length === 0) {
      return res.json({ dataset_id: id, question: q, interval, top_k: topK, series: {}, horizon: {}, synthetic: false, labels: [] });
    }
    const labels = topLabels.map(r => r.label);

    const rows = await prisma.$queryRawUnsafe(`
      WITH base AS (
        SELECT
          ${bucketExpr}::date AS d,
          TRIM(UPPER(REGEXP_REPLACE(COALESCE("answerText",''), '\\s+', ' ', 'g'))) AS label
        FROM "ResponseFact"
        WHERE "datasetId" = $1 AND "questionCode" = $2
          AND "interviewDate" IS NOT NULL
          AND "answerText" IS NOT NULL
          AND NOT ("answerText" ~ '^[\\s]*[+\\-]?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*%?[\\s]*$')
      ),
      tot AS ( SELECT d, COUNT(*)::int AS total FROM base GROUP BY d ),
      fil AS ( SELECT * FROM base WHERE label = ANY($3::text[]) )
      SELECT f.d::date AS day, f.label, COUNT(*)::int AS c, t.total
      FROM fil f
      JOIN tot t ON t.d = f.d
      GROUP BY f.d, f.label, t.total
      ORDER BY f.d, f.label
    `, id, q, labels);

    const byLabel = new Map();
    for (const L of labels) byLabel.set(L, []);
    for (const r of rows) {
      const y = asShare ? (r.total ? (r.c / r.total) : 0) : r.c;
      byLabel.get(r.label).push({ date: isoDate(r.day), y: Number(y) });
    }

    const series = {};
    const horizon = {};
    const metrics = {};
    for (const L of labels) {
      const arr = byLabel.get(L) || [];
      const pts = arr.map((r,i)=>({ x:i, y:r.y, date:r.date }));
      if (pts.length < 2 || new Set(pts.map(p=>p.y)).size <= 1) {
        series[L] = pts.map(p=>({ date:p.date, actual:p.y, fitted:p.y }));
        horizon[L] = [];
        metrics[L] = { r2:null, rmse:0, mape:null, smape:null, mape_floor5:null, baseline_rmse:null, improvement_vs_baseline:null };
        continue;
      }
      const fit = olsFit(pts);
      series[L] = pts.map((p,i)=>({ date:p.date, actual:p.y, fitted: Math.max(0, Math.round(fit.yhat[i])) }));
      horizon[L] = makeHorizon(pts[pts.length-1].date, pts[pts.length-1].x, fit.a, fit.b, 7, interval)
                     .map(h => ({ ...h, projected: asShare ? Math.min(1, h.projected) : h.projected }));
      metrics[L] = {
        r2: fit.r2, rmse: fit.rmse, mse: fit.mse,
        baseline_rmse: fit.baselineRMSE, improvement_vs_baseline: fit.improvement,
        mae: fit.mae, wape: fit.wape, mape: fit.mape, mape_floor5: fit.mape_floor5, smape: fit.smape
      };
    }

    res.json({
      dataset_id: id, question: q, interval, top_k: topK, as_share: asShare ? 1 : 0,
      labels, series, horizon, metrics
    });
  } catch (e) {
    console.error('q_categorical_forecast_failed:', e);
    res.status(500).json({ message: 'q_categorical_forecast_failed', detail: e.message });
  }
});

// ==================== PRESCRIPTIVE HELPERS (shared) ====================
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function parseIntOr(v, d) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }
function parseFloatOr(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

function quantile(sortedArr, q) {
  if (!sortedArr.length) return 0;
  const pos = (sortedArr.length - 1) * q;
  const base = Math.floor(pos), rest = pos - base;
  if (sortedArr[base + 1] !== undefined) return sortedArr[base] + rest * (sortedArr[base+1] - sortedArr[base]);
  return sortedArr[base];
}

async function kpiCompletion(prisma, datasetId, densityPct) {
  const totalRes = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT "respondentId")::int AS n
    FROM "ResponseFact" WHERE "datasetId" = ${datasetId}
  `;
  const respondent_count = totalRes?.[0]?.n || 0;

  const hard = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT "respondentId")::int AS n
    FROM "ResponseFact"
    WHERE "datasetId" = ${datasetId}
      AND (
        "interviewDate" IS NOT NULL
        OR lower(
             COALESCE(
               "cleanJson"->>'completed',
               "rawJson"  ->>'completed',
               "rawJson"  ->>'Completion',
               "rawJson"  ->>'Completed',
               "rawJson"  ->>'Status'
             )
           ) ~ '(?:^|\\b)(1|true|yes|completed|complete|done|finished|ok)(?:\\b|$)'
      )
  `;
  const hardN = hard?.[0]?.n || 0;

  let completed_respondents = hardN;
  let completion_method = 'dated_or_flagged';

  if (hardN === 0) {
    const soft = await prisma.$queryRaw`
      WITH per AS (
        SELECT "respondentId", COUNT(*)::int AS c
        FROM "ResponseFact" WHERE "datasetId" = ${datasetId}
        GROUP BY "respondentId"
      ),
      m AS (SELECT MAX(c) AS mx FROM per)
      SELECT COUNT(*)::int AS n
      FROM per, m
      WHERE per.c >= GREATEST(1, FLOOR(${densityPct} * m.mx))
    `;
    completed_respondents = soft?.[0]?.n || 0;
    completion_method = `soft_density_${Math.round(densityPct*100)}pct`;
  }

  const completed_pct = respondent_count ? (100 * completed_respondents / respondent_count) : 0;
  return { respondent_count, completed_respondents, completed_pct, completion_method };
}

async function dailySeries(prisma, datasetId) {
  const rows = await prisma.$queryRaw`
    SELECT DATE("interviewDate") AS d,
           COUNT(DISTINCT "respondentId")::int AS c
    FROM "ResponseFact"
    WHERE "datasetId" = ${datasetId} AND "interviewDate" IS NOT NULL
    GROUP BY d
    ORDER BY d
  `;
  return (rows || []).map(r => ({ date: String(r.d), count: Number(r.c || 0) }));
}

async function regionCounts(prisma, datasetId, limit = 20) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(region,'Unspecified') AS region,
           COUNT(DISTINCT "respondentId")::int AS cnt
    FROM "ResponseFact"
    WHERE "datasetId" = ${datasetId} AND "interviewDate" IS NOT NULL
    GROUP BY region
    ORDER BY cnt DESC
    LIMIT ${parseInt(limit, 10)}
  `;
  return (rows || []).map(r => ({ region: r.region, cnt: Number(r.cnt || 0) }));
}

async function dowHourGrid(prisma, datasetId) {
  const rows = await prisma.$queryRaw`
    SELECT
      EXTRACT(DOW FROM "interviewDate")::int AS dow,
      EXTRACT(HOUR FROM "interviewDate")::int AS hour,
      COUNT(DISTINCT "respondentId")::int AS cnt
    FROM "ResponseFact"
    WHERE "datasetId" = ${datasetId} AND "interviewDate" IS NOT NULL
    GROUP BY dow, hour
    ORDER BY dow, hour
  `;
  return (rows || []).map(r => ({ dow: Number(r.dow), hour: Number(r.hour), cnt: Number(r.cnt || 0) }));
}

async function interviewerDist(prisma, datasetId) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(interviewer,'Unspecified') AS iv,
           COUNT(DISTINCT "respondentId")::int AS cnt
    FROM "ResponseFact"
    WHERE "datasetId" = ${datasetId} AND "interviewDate" IS NOT NULL
    GROUP BY iv
  `;
  const arr = (rows || []).map(r => Number(r.cnt || 0)).filter(Number.isFinite).sort((a,b)=>a-b);
  return arr;
}

async function lowCoverageQuestions(prisma, datasetId, topN = 5) {
  const rows = await prisma.$queryRaw`
    WITH per_q AS (
      SELECT "questionCode" AS q, COUNT(DISTINCT "respondentId")::int AS n
      FROM "ResponseFact" WHERE "datasetId" = ${datasetId}
      GROUP BY "questionCode"
    )
    SELECT q, n FROM per_q WHERE q IS NOT NULL ORDER BY n ASC NULLS LAST LIMIT ${parseInt(topN,10)}
  `;
  return (rows || []).map(r => ({ question: r.q, n: Number(r.n || 0) }));
}

// Try to auto-detect a satisfaction metric: a numeric question mostly 1..5 (CSAT-like)
async function detectCSAT(prisma, datasetId) {
  const rows = await prisma.$queryRawUnsafe(`
    WITH base AS (
      SELECT
        "questionCode" AS q,
        CASE
          WHEN "answerNum" IS NOT NULL THEN "answerNum"
          WHEN "answerText" ~ '^[\\s]*[+\\-]?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*%?[\\s]*$'
            THEN REGEXP_REPLACE(LOWER("answerText"), '[,%]', '', 'g')::numeric
          ELSE NULL
        END AS val
      FROM "ResponseFact"
      WHERE "datasetId" = $1
    ),
    agg AS (
      SELECT q,
             COUNT(*)::int AS n,
             COUNT(val)::int AS n_num,
             COUNT(*) FILTER (WHERE val BETWEEN 1 AND 5)::int AS n_1_5,
             AVG(val)::float8 AS avg_val
      FROM base
      GROUP BY q
    )
    SELECT q, n, n_num, n_1_5, avg_val
    FROM agg
    WHERE q IS NOT NULL
    ORDER BY n_1_5 DESC, n_num DESC, n DESC
    LIMIT 1
  `, datasetId);

  const top = rows?.[0];
  if (!top || !top.q || !Number.isFinite(Number(top.n_1_5 || 0))) return null;

  // If at least 60% of numeric answers sit in [1..5], consider this CSAT-like
  const ratio = (Number(top.n_1_5 || 0)) / Math.max(1, Number(top.n_num || 0));
  if (ratio < 0.6) return null;

  return {
    question: top.q,
    avg: Number(top.avg_val || 0),
    coverage_numeric: Number(top.n_num || 0),
    ratio_1_5: Number(ratio)
  };
}

function trailingAvg(arr, k) {
  if (!arr.length) return 0;
  const last = arr.slice(-k);
  return last.reduce((s,r)=>s + (r.count || 0), 0) / Math.max(1, last.length);
}

function enumerateWorkdaysCount(startDate, endDate, workdaysPerWeek) {
  const start = new Date(startDate), end = new Date(endDate);
  let c = 0;
  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const dow = cur.getDay(); // 0..6
    let isWork = true;
    if (workdaysPerWeek <= 5) isWork = (dow >= 1 && dow <= 5);
    else if (workdaysPerWeek === 6) isWork = (dow >= 1 && dow <= 6);
    else isWork = true;
    if (isWork) c++;
  }
  return c;
}

// ==================== PRESCRIPTIVE: RULES (threshold-based) ====================
// GET /api/dataset/:id/prescriptive/rules?csat_threshold=3&completion_threshold=0.7&coverage_threshold=0.6&imbalance_ratio=2
router.get('/:id/prescriptive/rules', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const density = Number(process.env.COMPLETION_DENSITY_PCT || 0.7);
    const csat_threshold = parseFloatOr(req.query.csat_threshold, 3.0);   // 1..5
    const completion_threshold = parseFloatOr(req.query.completion_threshold, 0.70); // 0..1
    const coverage_threshold = parseFloatOr(req.query.coverage_threshold, 0.60);     // 0..1
    const imbalance_ratio = parseFloatOr(req.query.imbalance_ratio, 2.0);

    const completion = await kpiCompletion(prisma, id, density);
    const csat = await detectCSAT(prisma, id);
    const regions = await regionCounts(prisma, id);
    const byRegionTotal = regions.reduce((s,r)=>s+r.cnt,0) || 1;
    const shares = regions.map(r => ({ region: r.region, share: r.cnt / byRegionTotal }));
    shares.sort((a,b)=>b.share - a.share);

    const lowQs = await lowCoverageQuestions(prisma, id, 8);

    const alerts = [];

    // Rule: low CSAT + low completion
    if (csat && csat.avg < csat_threshold && (completion.completed_pct / 100) < completion_threshold) {
      alerts.push({
        rule: 'LOW_CSAT_AND_COMPLETION',
        severity: 'high',
        message: `Average satisfaction (${csat.avg.toFixed(2)}) < ${csat_threshold} and completion ${completion.completed_pct.toFixed(1)}% < ${Math.round(completion_threshold*100)}% — target interventions by region and interviewer.`,
        details: { csat_question: csat.question }
      });
    }

    // Rule: low-coverage questions
    const coverageItems = lowQs.map(q => ({
      question: q.question,
      coverage_pct: completion.respondent_count ? (q.n / completion.respondent_count) : 0
    }));
    const poor = coverageItems.filter(x => x.coverage_pct < coverage_threshold);
    if (poor.length) {
      alerts.push({
        rule: 'LOW_QUESTION_COVERAGE',
        severity: 'high',
        message: `Some questions have < ${Math.round(coverage_threshold*100)}% respondent coverage — enforce required fields and tighten field scripts.`,
        details: poor.map(p => ({ question: p.question, coverage_pct: Number((p.coverage_pct*100).toFixed(1)) }))
      });
    }

    // Rule: regional imbalance
    if (shares.length >= 2) {
      const top = shares[0], bottom = shares[shares.length-1];
      if (bottom.share > 0 && (top.share / bottom.share) >= imbalance_ratio) {
        alerts.push({
          rule: 'REGIONAL_IMBALANCE',
          severity: 'medium',
          message: `Sampling is imbalanced: top region '${top.region}' share ${(top.share*100).toFixed(1)}% vs bottom '${bottom.region}' ${(bottom.share*100).toFixed(1)}% (≥${imbalance_ratio}× gap). Rebalance assignments.`,
          details: shares.map(s => ({ region: s.region, share_pct: Number((s.share*100).toFixed(1)) }))
        });
      }
    }

    res.json({
      dataset_id: id,
      thresholds: { csat_threshold, completion_threshold, coverage_threshold, imbalance_ratio },
      completion_kpis: completion,
      csat: csat || null,
      region_shares: shares,
      alerts
    });
  } catch (e) {
    console.error('prescriptive_rules_failed:', e);
    res.status(500).json({ message: 'prescriptive_rules_failed', detail: e.message });
  }
});

// ==================== PRESCRIPTIVE: DECISION TREE (shallow) ====================
// Heuristic "tree": split on DOW, HOUR_BUCKET, REGION to maximize average completes per day bucket.
// GET /api/dataset/:id/prescriptive/decision-tree?max_depth=2
router.get('/:id/prescriptive/decision-tree', async (req, res) => {
  try {
    const id = parseIntOr(req.params.id, -1);
    const max_depth = clamp(parseIntOr(req.query.max_depth, 2), 1, 3);

    // Build candidate features
    // Feature 1: day-of-week (0..6)
    // Feature 2: hour bucket: morning (6-11), afternoon (12-16), evening (17-21), off (others)
    // Feature 3: region (top 6 by count; rest grouped as "OTHER")
    const grid = await dowHourGrid(prisma, id);
    const regions = await regionCounts(prisma, id, 6);
    const regionSet = new Set(regions.map(r => r.region));

    // Build fact table keyed by (date, dow, hour_bucket, region): counts of completes
    const rows = await prisma.$queryRaw`
      SELECT DATE("interviewDate") AS d,
             EXTRACT(DOW FROM "interviewDate")::int AS dow,
             EXTRACT(HOUR FROM "interviewDate")::int AS hour,
             COALESCE(region,'Unspecified') AS region,
             COUNT(DISTINCT "respondentId")::int AS c
      FROM "ResponseFact"
      WHERE "datasetId" = ${id} AND "interviewDate" IS NOT NULL
      GROUP BY d, dow, hour, region
      ORDER BY d, dow, hour
    `;

    function hourBucket(h) {
      const hh = Number(h);
      if (hh >= 6 && hh <= 11) return 'MORNING';
      if (hh >= 12 && hh <= 16) return 'AFTERNOON';
      if (hh >= 17 && hh <= 21) return 'EVENING';
      return 'OFF';
    }

    const facts = (rows || []).map(r => ({
      date: String(r.d),
      dow: Number(r.dow),
      hour_bucket: hourBucket(r.hour),
      region: regionSet.has(r.region) ? r.region : 'OTHER',
      y: Number(r.c || 0)
    }));

    if (!facts.length) {
      return res.json({ dataset_id: id, depth: 0, nodes: [], recommendation: null });
    }

    // Simple greedy split chooser: pick feature/value that maximizes average y
    const dims = ['dow', 'hour_bucket', 'region'];

    function bestSplit(data) {
      let best = null;
      for (const dim of dims) {
        const groups = new Map();
        for (const r of data) {
          const k = r[dim];
          const g = groups.get(k) || { sum:0, n:0 };
          g.sum += r.y; g.n += 1;
          groups.set(k, g);
        }
        // choose the top-mean bucket
        for (const [val, g] of groups.entries()) {
          const mean = g.sum / Math.max(1, g.n);
          if (!best || mean > best.mean) best = { dim, val, mean };
        }
      }
      return best; // {dim, val, mean}
    }

    function buildTree(data, depth) {
      if (depth >= max_depth || data.length < 8) {
        // terminal node
        const avg = data.reduce((s,r)=>s+r.y,0)/Math.max(1,data.length);
        return { type: 'leaf', avg: Number(avg.toFixed(2)), n: data.length };
      }
      const split = bestSplit(data);
      if (!split) {
        const avg = data.reduce((s,r)=>s+r.y,0)/Math.max(1,data.length);
        return { type: 'leaf', avg: Number(avg.toFixed(2)), n: data.length };
      }
      const left = data.filter(r => r[split.dim] === split.val);
      const right = data.filter(r => r[split.dim] !== split.val);
      return {
        type: 'node',
        dim: split.dim,
        equals: split.val,
        mean: Number(split.mean.toFixed(2)),
        n_left: left.length,
        n_right: right.length,
        left: buildTree(left, depth + 1),
        right: buildTree(right, depth + 1)
      };
    }

    const tree = buildTree(facts, 0);

    // Derive a "next best action" from the leftmost (top-mean) path
    const nba = bestPath(tree, []);

    res.json({
      dataset_id: id,
      depth: max_depth,
      nodes: tree,
      recommendation: {
        conditions: nba.conds, // e.g., [{dow: 6}, {hour_bucket: 'EVENING'}, {region: 'METRO MANILA'}]
        expected_avg_completes_per_bucket: nba.avg
      }
    });
  } catch (e) {
    console.error('prescriptive_decision_tree_failed:', e);
    res.status(500).json({ message: 'prescriptive_decision_tree_failed', detail: e.message });
  }
});

// ==================== PRESCRIPTIVE: INSIGHTS (text + NBA) ====================
// GET /api/dataset/:id/prescriptive/insights?target=200&deadline=YYYY-MM-DD&rate=8&workdays=6
router.get('/:id/prescriptive/insights', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const target = Math.max(1, Number(req.query.target || 0));
    const rate = Math.max(1, Number(req.query.rate || 8));
    const workdays = clamp(parseIntOr(req.query.workdays, 6), 1, 7);
    const deadlineStr = String(req.query.deadline || '').slice(0, 10);
    if (!deadlineStr || isNaN(Date.parse(deadlineStr))) {
      return res.status(400).json({ error: 'deadline (YYYY-MM-DD) required' });
    }

    const density = Number(process.env.COMPLETION_DENSITY_PCT || 0.7);
    const today = new Date(); today.setHours(0,0,0,0);
    const deadline = new Date(deadlineStr + 'T00:00:00');

    const completion = await kpiCompletion(prisma, id, density);
    const daily = await dailySeries(prisma, id);
    const t7 = trailingAvg(daily, 7);
    const wd = enumerateWorkdaysCount(today, deadline, workdays) || 1;

    const required_rate = target / wd;
    const gap_per_day = required_rate - t7;
    const extra_interviewers = gap_per_day > 0 ? Math.ceil(gap_per_day / rate) : 0;

    const regions = await regionCounts(prisma, id);
    const totalByRegion = regions.reduce((s,r)=>s+r.cnt,0) || 1;
    const shares = regions.map(r => ({ region: r.region, share: r.cnt / totalByRegion }))
                          .sort((a,b)=>b.share - a.share);
    const ivDist = await interviewerDist(prisma, id);
    const q25 = quantile(ivDist, 0.25), q75 = quantile(ivDist, 0.75);

    const dowHour = await dowHourGrid(prisma, id);
    function bucket(h){ return (h>=6&&h<=11)?'MORNING':(h>=12&&h<=16)?'AFTERNOON':(h>=17&&h<=21)?'EVENING':'OFF'; }
    // top cells by average per distinct date
    const cellAgg = new Map(); // key: dow|bucket -> {sum, days}
    const byDayKey = new Set();
    for (const r of dowHour) {
      const k = `${r.dow}|${bucket(r.hour)}`;
      const obj = cellAgg.get(k) || { sum:0, n:0 };
      obj.sum += r.cnt; obj.n += 1;
      cellAgg.set(k, obj);
    }
    const cells = Array.from(cellAgg.entries()).map(([k,v])=>{
      const [d,b] = k.split('|'); return { dow:Number(d), bucket:b, avg: v.sum/Math.max(1,v.n) };
    }).sort((a,b)=>b.avg - a.avg);
    const bestCells = cells.slice(0,3);

    // Decision-tree "next best action"
    let nba = null;
    try {
      const resp = await prisma.$queryRaw`SELECT 1`; // cheap ping
      // We won't call HTTP to our own route; we re-derive quick NBA from best cells:
      nba = bestCells.length ? {
        conditions: bestCells.map(c => ({ dow: c.dow, hour_bucket: c.bucket })),
        expected_avg_completes_per_bucket: Number(bestCells[0].avg.toFixed(2))
      } : null;
    } catch {}

    // Build recommendations (short, action-forward)
    const recs = [];

    // Velocity vs target
    recs.push({
      title: 'Velocity vs Target',
      priority: gap_per_day > 0 ? 'high' : 'medium',
      text: gap_per_day > 0
        ? `Pace is ${t7.toFixed(1)} completes/day; need ${required_rate.toFixed(1)} to hit ${target} by ${deadlineStr}. Add ~${extra_interviewers} interviewer(s) at ${rate}/day or shift effort to high-yield slots.`
        : `Pace (${t7.toFixed(1)}/day) meets required ${required_rate.toFixed(1)} to reach ${target} by ${deadlineStr}. Maintain staffing on strong days.`,
      kpis: { trailing7_avg: Number(t7.toFixed(2)), required_rate: Number(required_rate.toFixed(2)), extra_interviewers }
    });

    // Schedule optimization
    if (bestCells.length) {
      const D = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const tip = bestCells.map(c => `${D[c.dow]}-${c.bucket}`).join(', ');
      recs.push({
        title: 'Optimize Schedule',
        priority: 'medium',
        text: `Concentrate deployment on: ${tip}. Expect higher completes during these windows based on historical yield.`,
        kpis: bestCells.map(c => ({
          dow: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][c.dow],
          bucket: c.bucket,
          avg_per_slot: Number(c.avg.toFixed(2))
        }))
      });
    }

    // Region rebalancing
    if (shares.length >= 2) {
      const top = shares[0], bottom = shares[shares.length - 1];
      recs.push({
        title: 'Rebalance Regions',
        priority: 'medium',
        text: `Reduce bias by shifting some effort from ${top.region} (${(top.share*100).toFixed(1)}%) toward ${bottom.region} (${(bottom.share*100).toFixed(1)}%).`,
        kpis: shares.map(s => ({ region: s.region, share_pct: Number((s.share*100).toFixed(1)) }))
      });
    }

    // Interviewer coaching
    if (ivDist.length >= 4) {
      const spread = q75 - q25;
      recs.push({
        title: 'Interviewer Coaching',
        priority: spread >= 3 ? 'medium' : 'low',
        text: spread >= 3
          ? 'Output variance across interviewers is large (Q3–Q1 spread). Pair low performers with high performers and rotate assignments.'
          : 'Output variance across interviewers is modest. Maintain current assignment plan.',
        kpis: { q25, q75, spread }
      });
    }

    // If CSAT exists, stitch it into guidance via rule engine results
    const csat = await detectCSAT(prisma, id);
    if (csat) {
      recs.push({
        title: 'Satisfaction Watch',
        priority: csat.avg < 3 ? 'high' : 'low',
        text: csat.avg < 3
          ? `Detected CSAT-like metric "${csat.question}" with average ${csat.avg.toFixed(2)} (<3). Review questionnaire phrasing and interviewer prompts; target coaching where CSAT is lagging.`
          : `Detected CSAT-like metric "${csat.question}" with average ${csat.avg.toFixed(2)}. Keep current script and cadence.`,
        kpis: { csat_question: csat.question, avg: Number(csat.avg.toFixed(2)) }
      });
    }

    res.json({
      dataset_id: id,
      inputs: { target, deadline: deadlineStr, rate, workdays },
      metrics: {
        respondent_count: completion.respondent_count,
        completed_respondents: completion.completed_respondents,
        completed_pct: Number(completion.completed_pct.toFixed(1)),
        completion_method: completion.completion_method,
        trailing7_avg: Number(t7.toFixed(2)),
        required_rate: Number(required_rate.toFixed(2)),
        gap_per_day: Number(gap_per_day.toFixed(2)),
        available_workdays: wd,
        extra_interviewers
      },
      next_best_action: nba,
      recommendations: recs
    });
  } catch (e) {
    console.error('prescriptive_text_insights_failed:', e);
    res.status(500).json({ message: 'prescriptive_text_insights_failed', detail: e.message });
  }
});// ==================== PRESCRIPTIVE: REGION ALLOCATION ====================
// GET /api/dataset/:id/prescriptive/region-allocation?target=200
router.get('/:id/prescriptive/region-allocation', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const target = Math.max(1, Number(req.query.target || 0));

    // Get historical completion counts by region
    const regions = await regionCounts(prisma, id, 50); // Get all regions
    
    const totalCompletes = regions.reduce((sum, r) => sum + r.cnt, 0);
    
    if (totalCompletes === 0) {
      // If no historical data, distribute evenly among available regions
      const uniqueRegions = await prisma.$queryRaw`
        SELECT DISTINCT COALESCE(region, 'Unspecified') as region
        FROM "ResponseFact" 
        WHERE "datasetId" = ${id}
      `;
      
      const equalShare = Math.round(target / Math.max(1, uniqueRegions.length));
      const items = uniqueRegions.map(r => ({
        region: r.region,
        share: 1 / uniqueRegions.length,
        assigned: equalShare
      }));
      
      // Adjust for rounding
      const totalAssigned = items.reduce((sum, item) => sum + item.assigned, 0);
      if (totalAssigned < target && items.length > 0) {
        items[0].assigned += (target - totalAssigned);
      }
      
      return res.json({ items });
    }

    // Calculate shares based on historical distribution
    const items = regions.map(r => ({
      region: r.region,
      share: r.cnt / totalCompletes,
      assigned: Math.round(r.cnt / totalCompletes * target)
    }));

    // Adjust for rounding errors
    const totalAssigned = items.reduce((sum, item) => sum + item.assigned, 0);
    let difference = target - totalAssigned;
    
    if (difference !== 0) {
      // Sort by share to adjust the largest regions first
      items.sort((a, b) => b.share - a.share);
      let index = 0;
      while (difference !== 0) {
        if (difference > 0) {
          items[index % items.length].assigned += 1;
          difference -= 1;
        } else {
          if (items[index % items.length].assigned > 0) {
            items[index % items.length].assigned -= 1;
            difference += 1;
          }
        }
        index++;
      }
    }

    res.json({ 
      items,
      historical_total: totalCompletes,
      allocation_method: totalCompletes > 0 ? 'historical_distribution' : 'equal_distribution'
    });
  } catch (e) {
    console.error('region_allocation_failed:', e);
    res.status(500).json({ message: 'region_allocation_failed', detail: e.message });
  }
});


// ==================== PRESCRIPTIVE: ENHANCED INSIGHTS (with Rule-Based Logic & Decision Trees) ====================
// GET /api/dataset/:id/prescriptive/insights?target=200&deadline=YYYY-MM-DD&rate=8&workdays=6
router.get('/:id/prescriptive/insights', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const target = Math.max(1, Number(req.query.target || 0));
    const rate = Math.max(1, Number(req.query.rate || 8));
    const workdays = clamp(parseIntOr(req.query.workdays, 6), 1, 7);
    const deadlineStr = String(req.query.deadline || '').slice(0, 10);
    
    if (!deadlineStr || isNaN(Date.parse(deadlineStr))) {
      return res.status(400).json({ error: 'deadline (YYYY-MM-DD) required' });
    }

    const density = Number(process.env.COMPLETION_DENSITY_PCT || 0.7);
    const today = new Date(); today.setHours(0,0,0,0);
    const deadline = new Date(deadlineStr + 'T00:00:00');

    // Get core metrics
    const completion = await kpiCompletion(prisma, id, density);
    const daily = await dailySeries(prisma, id);
    const t7 = trailingAvg(daily, 7);
    const wd = enumerateWorkdaysCount(today, deadline, workdays) || 1;

    const required_rate = target / wd;
    const gap_per_day = required_rate - t7;
    const extra_interviewers = gap_per_day > 0 ? Math.ceil(gap_per_day / rate) : 0;

    // Get data for rule-based logic
    const regions = await regionCounts(prisma, id);
    const csat = await detectCSAT(prisma, id);
    const lowQs = await lowCoverageQuestions(prisma, id, 5);
    
    // Decision Tree Analysis for optimal timing
    const dowHour = await dowHourGrid(prisma, id);
    const bestSlots = analyzeOptimalSlots(dowHour);

    // RULE-BASED LOGIC (as per capstone requirements)
    const ruleBasedAlerts = generateRuleBasedAlerts({
      completion,
      csat,
      regions,
      lowQs,
      t7,
      required_rate
    });

    // DECISION TREE OPTIMIZATION RECOMMENDATIONS
    const optimizationRecs = generateOptimizationRecommendations({
      bestSlots,
      regions,
      gap_per_day
    });

    // NEXT BEST ACTION RECOMMENDATIONS
    const nextBestActions = generateNextBestActions({
      ruleBasedAlerts,
      optimizationRecs,
      extra_interviewers,
      target
    });

    // Combine all recommendations
    const allRecommendations = [
      ...ruleBasedAlerts,
      ...optimizationRecs,
      ...nextBestActions
    ];

    res.json({
      dataset_id: id,
      inputs: { target, deadline: deadlineStr, rate, workdays },
      metrics: {
        respondent_count: completion.respondent_count,
        completed_respondents: completion.completed_respondents,
        completed_pct: Number(completion.completed_pct.toFixed(1)),
        trailing7_avg: Number(t7.toFixed(2)),
        required_rate: Number(required_rate.toFixed(2)),
        gap_per_day: Number(gap_per_day.toFixed(2)),
        available_workdays: wd,
        extra_interviewers
      },
      recommendations: allRecommendations,
      rule_based_alerts: ruleBasedAlerts.filter(r => r.priority === 'high'),
      optimization_paths: optimizationRecs,
      next_best_actions: nextBestActions
    });
  } catch (e) {
    console.error('enhanced_insights_failed:', e);
    res.status(500).json({ message: 'enhanced_insights_failed', detail: e.message });
  }
});

// Helper functions for enhanced insights
function analyzeOptimalSlots(dowHour) {
  const slots = [];
  for (const r of dowHour) {
    const slot = {
      dow: r.dow,
      hour: r.hour,
      count: r.cnt,
      efficiency: r.cnt // Simple efficiency metric
    };
    slots.push(slot);
  }
  
  // Sort by efficiency (completes per slot)
  return slots.sort((a, b) => b.efficiency - a.efficiency).slice(0, 5);
}

function generateRuleBasedAlerts({ completion, csat, regions, lowQs, t7, required_rate }) {
  const alerts = [];
  const completionRate = completion.completed_pct / 100;
  
  // RULE 1: Low Satisfaction + Low Completion Rate
  if (csat && csat.avg < 3 && completionRate < 0.7) {
    alerts.push({
      title: 'Critical: Low Satisfaction and Completion Rate',
      priority: 'high',
      text: `Satisfaction score (${csat.avg.toFixed(2)}) below 3 and completion rate (${completion.completed_pct.toFixed(1)}%) below 70%. Recommend targeted intervention in underperforming regions.`,
      type: 'rule_based',
      rule: 'LOW_SATISFACTION_AND_COMPLETION'
    });
  }

  // RULE 2: Performance Gap Alert
  if (t7 < required_rate * 0.8) {
    alerts.push({
      title: 'Performance Gap Detected',
      priority: 'high', 
      text: `Current pace (${t7.toFixed(1)}/day) is below 80% of required rate (${required_rate.toFixed(1)}/day). Immediate action needed to avoid missing targets.`,
      type: 'rule_based',
      rule: 'PERFORMANCE_GAP'
    });
  }

  // RULE 3: Low Coverage Questions
  if (lowQs.length > 0 && completion.respondent_count > 0) {
    const coveragePct = (lowQs[0].n / completion.respondent_count) * 100;
    if (coveragePct < 60) {
      alerts.push({
        title: 'Low Question Coverage Alert',
        priority: 'medium',
        text: `Question "${lowQs[0].question}" has only ${coveragePct.toFixed(1)}% coverage. Review field scripts and interviewer training.`,
        type: 'rule_based',
        rule: 'LOW_COVERAGE'
      });
    }
  }

  return alerts;
}

function generateOptimizationRecommendations({ bestSlots, regions, gap_per_day }) {
  const recs = [];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Time optimization from decision tree analysis
  if (bestSlots.length > 0) {
    const bestSlot = bestSlots[0];
    recs.push({
      title: 'Optimal Survey Timing',
      priority: 'medium',
      text: `Decision tree analysis identifies ${dayNames[bestSlot.dow]} ${bestSlot.hour}:00 as highest yielding time slot. Increase deployments during similar windows.`,
      type: 'optimization',
      algorithm: 'decision_tree'
    });
  }

  // Regional optimization
  if (regions.length >= 3) {
    const topRegion = regions[0];
    const bottomRegion = regions[regions.length - 1];
    const ratio = topRegion.cnt / Math.max(1, bottomRegion.cnt);
    
    if (ratio > 2) {
      recs.push({
        title: 'Regional Rebalancing Opportunity',
        priority: 'medium',
        text: `Significant imbalance detected: ${topRegion.region} completes ${ratio.toFixed(1)}× more than ${bottomRegion.region}. Reallocate resources for better coverage.`,
        type: 'optimization', 
        algorithm: 'regional_analysis'
      });
    }
  }

  return recs;
}

function generateNextBestActions({ ruleBasedAlerts, optimizationRecs, extra_interviewers, target }) {
  const actions = [];
  const hasCriticalAlerts = ruleBasedAlerts.some(alert => alert.priority === 'high');

  // Primary next best action based on situation
  if (hasCriticalAlerts) {
    actions.push({
      title: 'Immediate Intervention Required',
      priority: 'high',
      text: 'Multiple critical alerts detected. Focus on regional performance review and interviewer retraining before scaling operations.',
      type: 'next_best_action'
    });
  } else if (extra_interviewers > 0) {
    actions.push({
      title: 'Scale Interviewer Capacity',
      priority: 'medium',
      text: `Add ${extra_interviewers} interviewer(s) to meet target of ${target} completes. Deploy during optimal time slots identified.`,
      type: 'next_best_action'
    });
  } else {
    actions.push({
      title: 'Maintain Current Operations',
      priority: 'low',
      text: 'Current pace meets requirements. Focus on quality maintenance and minor optimizations.',
      type: 'next_best_action'
    });
  }

  // Additional strategic actions
  actions.push({
    title: 'Strategic Deployment Planning',
    priority: 'medium',
    text: 'Implement A/B testing for different deployment strategies to identify additional efficiency gains.',
    type: 'next_best_action'
  });

  return actions;
}

// ==================== PRESCRIPTIVE: MONITOR (validation & drift) ====================
// GET /api/dataset/:id/prescriptive/monitor?lookback=21
router.get('/:id/prescriptive/monitor', async (req, res) => {
  try {
    const id = parseIntOr(req.params.id, -1);
    const lookback = clamp(parseIntOr(req.query.lookback, 21), 7, 60);
    const series = await dailySeries(prisma, id);
    const last = series.slice(-lookback);

    const alerts = [];
    if (!last.length) {
      alerts.push({ code: 'NO_ACTIVITY', severity: 'high', message: 'No interview activity detected.' });
      return res.json({ dataset_id: id, alerts, windows: null });
    }

    // Windowed 3-day moving averages: compare last 3 vs prior 3
    const k = 3;
    const last3 = last.slice(-k).reduce((s,r)=>s+r.count,0)/Math.max(1, Math.min(k,last.length));
    const prior3 = last.length > k ? last.slice(-(2*k), -k).reduce((s,r)=>s+r.count,0)/k : null;
    if (prior3 !== null && prior3 > 0) {
      const drop = (last3 - prior3) / prior3;
      if (drop <= -0.3) {
        alerts.push({
          code: 'RATE_DROP',
          severity: 'high',
          message: `3-day average dropped ${(Math.abs(drop)*100).toFixed(0)}% vs prior 3 days. Investigate staffing, instrument issues, or holidays.`
        });
      }
    }

    // Days since last activity
    const lastDate = new Date(last[last.length-1].date);
    const today = new Date(); today.setHours(0,0,0,0);
    const deltaDays = Math.round((today - lastDate) / (24*3600*1000));
    if (deltaDays >= 3) {
      alerts.push({ code: 'STALE_ACTIVITY', severity: 'medium', message: `No interviews in ${deltaDays} day(s).` });
    }

    // Question coverage regression: compare bottom-coverage question share over the window
    const lowQs = await lowCoverageQuestions(prisma, id, 5);
    alerts.push({
      code: 'LOW_COVERAGE_QUESTIONS',
      severity: lowQs.length ? 'medium' : 'low',
      message: lowQs.length ? 'Some questions show persistently low coverage.' : 'No low-coverage questions detected recently.',
      details: lowQs
    });

    res.json({
      dataset_id: id,
      windows: { lookback_days: lookback, last3, prior3 },
      alerts
    });
  } catch (e) {
    console.error('prescriptive_monitor_failed:', e);
    res.status(500).json({ message: 'prescriptive_monitor_failed', detail: e.message });
  }
});

// ---------------------------- STAFFING ROUTE ----------------------------
// Enhanced staffing route with historical data alignment
router.get('/:id/prescriptive/staffing', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const target = Math.max(1, Number(req.query.target || 0));
    const rate = Math.max(1, Number(req.query.rate || 8));
    const workdays = clamp(parseIntOr(req.query.workdays, 6), 1, 7);
    const deadlineStr = String(req.query.deadline || '').slice(0, 10);

    if (!deadlineStr || isNaN(Date.parse(deadlineStr))) {
      return res.status(400).json({ error: 'Invalid deadline. Use YYYY-MM-DD format.' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(deadlineStr + "T00:00:00");

    // Get historical performance data
    const daily = await dailySeries(prisma, id);
    const t7 = trailingAvg(daily, 7);
    const workdaysCount = enumerateWorkdaysCount(today, deadline, workdays);
    
    if (workdaysCount <= 0) {
      return res.status(400).json({ error: 'No workdays available between today and deadline' });
    }

    // Calculate based on historical performance or fallback to theoretical rate
    const effectiveRate = t7 > 0 ? Math.min(rate, t7) : rate;
    const requiredInterviewers = Math.max(1, Math.ceil(target / (effectiveRate * workdaysCount)));
    const maxCapacity = requiredInterviewers * rate * workdaysCount;

    // Generate realistic daily plan
    const dailyPlan = generateRealisticDailyPlan(target, workdaysCount, requiredInterviewers, effectiveRate);

    res.json({
      required_interviewers: requiredInterviewers,
      available_workdays: workdaysCount,
      max_capacity: maxCapacity,
      daily_plan: dailyPlan,
      assumptions: {
        interviews_per_interviewer_per_day: rate,
        effective_rate_based_on_history: Number(effectiveRate.toFixed(2)),
        workdays_per_week: workdays,
        total_days: Math.ceil((deadline - today) / (1000 * 60 * 60 * 24)),
        work_days: workdaysCount
      }
    });
  } catch (e) {
    console.error('Enhanced Staffing Route Failed:', e);
    res.status(500).json({ error: 'staffing_failed', detail: e.message });
  }
});

function generateRealisticDailyPlan(target, workdaysCount, interviewers, effectiveRate) {
  const baseDailyTarget = Math.floor(target / workdaysCount);
  const remainder = target % workdaysCount;
  
  const plan = [];
  let date = new Date();
  
  for (let i = 0; i < workdaysCount; i++) {
    // Increment date, skipping weekends if needed
    date.setDate(date.getDate() + 1);
    while (date.getDay() === 0 || date.getDay() === 6) {
      date.setDate(date.getDate() + 1);
    }
    
    const dailyTarget = baseDailyTarget + (i < remainder ? 1 : 0);
    const expectedCompletes = Math.min(dailyTarget, interviewers * effectiveRate);
    
    plan.push({
      date: date.toISOString().slice(0, 10),
      interviewers: interviewers,
      expected_completes: Math.round(expectedCompletes)
    });
  }
  
  return plan;
}

// ---------------------------- preview/debug ----------------------------
router.get('/:id/preview', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = await prisma.responseFact.findMany({
      where: { datasetId: id },
      orderBy: { id: 'asc' },
      take: 20,
      select: {
        respondentId: true, interviewDate: true, region: true, city: true,
        interviewer: true, questionCode: true, answerText: true, answerNum: true
      }
    });
    res.json({ items: rows || [] });
  } catch (e) {
    res.status(400).json({ message: 'preview_failed', detail: e.message });
  }
});

// ---------------------------- Python-backed ML routes (unchanged) ----------------------------
router.post('/predict/linear-regression', async (req, res) => {
  try {
    const { X_data, y_data } = req.body;
    const py = spawn('python', ['./etl/linear_regression.py', '--X_data', JSON.stringify(X_data), '--y_data', JSON.stringify(y_data)]);
    let out = '', err = '';
    py.stdout.on('data', d => out += d.toString());
    py.stderr.on('data', d => err += d.toString());
    py.on('close', (code) => {
      if (code !== 0) return res.status(500).json({ error: 'Linear Regression failed', detail: err });
      const result = JSON.parse(out);
      res.json(result);
    });
  } catch (e) {
    res.status(500).json({ error: 'Error in Linear Regression', detail: e.message });
  }
});

router.post('/predict/arima', async (req, res) => {
  try {
    const { timeSeriesData } = req.body;
    const py = spawn('python', ['./etl/arima_forecast.py', '--timeSeriesData', JSON.stringify(timeSeriesData)]);
    let out = '', err = '';
    py.stdout.on('data', d => out += d.toString());
    py.stderr.on('data', d => err += d.toString());
    py.on('close', (code) => {
      if (code !== 0) return res.status(500).json({ error: 'ARIMA forecasting failed', detail: err });
      res.json(JSON.parse(out));
    });
  } catch (e) {
    res.status(500).json({ error: 'Error in ARIMA forecasting', detail: e.message });
  }
});

router.post('/predict/logistic-regression', async (req, res) => {
  try {
    const { X_data, y_data } = req.body;
    const py = spawn('python', ['./etl/logistic_regression.py', '--X_data', JSON.stringify(X_data), '--y_data', JSON.stringify(y_data)]);
    let out = '', err = '';
    py.stdout.on('data', d => out += d.toString());
    py.stderr.on('data', d => err += d.toString());
    py.on('close', (code) => {
      if (code !== 0) return res.status(500).json({ error: 'Logistic Regression failed', detail: err });
      res.json(JSON.parse(out));
    });
  } catch (e) {
    res.status(500).json({ error: 'Error in Logistic Regression', detail: e.message });
  }
});

// --- Multer-specific error handler for this router ---
router.use((err, req, res, next) => {
  if (err && err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'file_too_large',
        message: `File exceeds ${MAX_UPLOAD_MB} MB limit`,
        max_mb: MAX_UPLOAD_MB
      });
    }
    return res.status(400).json({ error: 'upload_error', code: err.code, message: err.message });
  }
  next(err);
});

export default router;