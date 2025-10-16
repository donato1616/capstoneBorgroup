// backend/etl/loader.js (ESM)
import xlsx from "xlsx";
import fs from "fs";
import path from "path";
import { normalizeHeader } from "./canonical.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadMappings() {
  const dir = path.join(__dirname, "mappings");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

export function chooseMapping(filename) {
  const maps = loadMappings();
  const match = maps.find((m) =>
    (m.filePatterns || []).some((p) => filename.toLowerCase().includes(p.toLowerCase()))
  );
  return match || maps.find((m) => (m.filePatterns || []).length === 0) || {};
}

export function readBestSheet(buffer, filename, mapping = {}) {
  const wb = xlsx.read(buffer, { type: "buffer" });

  const preferred = mapping.sheetPreference || [];
  let sheetName =
    wb.SheetNames.find((n) => preferred.includes(n)) ||
    wb.SheetNames.sort((a, b) => {
      const aw = /dump|main sample|data/i.test(a) ? 1 : 0;
      const bw = /dump|main sample|data/i.test(b) ? 1 : 0;
      return bw - aw;
    })[0];

  const ws = wb.Sheets[sheetName];
  let rows = xlsx.utils.sheet_to_json(ws, { defval: "", raw: false });

  const headerOffset = mapping.headerRowOffset || 0;
  if (headerOffset > 0) rows = rows.slice(headerOffset);

  const keys = Object.keys(rows[0] || {});
  const keep = keys.filter((k) => {
    if (/^Unnamed/i.test(k)) {
      const anyVal = rows.some((r) => r[k] !== "" && r[k] !== null);
      return anyVal;
    }
    return true;
  });

  rows = rows.map((r) => {
    const o = {};
    for (const k of keep) o[k] = r[k];
    return o;
  });

  const normMap = {};
  keep.forEach((k) => (normMap[normalizeHeader(k)] = k));

  return { sheetName, rows, normMap, headers: keep };
}
