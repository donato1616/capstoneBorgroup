#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, os, re
from datetime import datetime, time, UTC
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

import pandas as pd
import yaml

# ---------- helpers ----------

def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.strip().lower())

def read_config(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {"synonyms": {}, "sheet_priority": []}
    return yaml.safe_load(path.read_text()) or {}

def list_files(in_path: Path) -> List[Path]:
    if in_path.is_dir():
        files = []
        for ext in ("*.xlsx", "*.xls", "*.csv"):
            files += sorted(in_path.glob(ext))
        if not files:
            raise SystemExit(f"No Excel/CSV files found in: {in_path}")
        return files
    else:
        if not in_path.exists():
            raise SystemExit(f"Input not found: {in_path}")
        return [in_path]

def best_sheet_for_excel(xls: pd.ExcelFile, synonyms: Dict[str, List[str]], preferred: List[str]) -> str:
    # 1) respect priority if sheet exists
    for name in preferred:
        if name in xls.sheet_names:
            return name
    # 2) otherwise, pick the sheet that has the most “recognizable” columns
    best = None; best_score = -1
    for s in xls.sheet_names:
        try:
            head = pd.read_excel(xls, sheet_name=s, nrows=0)
            cols = [slug(str(c)) for c in head.columns]
            score = 0
            for _, cands in synonyms.items():
                for c in cands:
                    if slug(c) in cols:
                        score += 1
                        break
            if score > best_score:
                best_score, best = score, s
        except Exception:
            pass
    return best or xls.sheet_names[0]

def read_any(path: Path, cfg: Dict[str, Any]) -> Tuple[pd.DataFrame, str]:
    # returns (df, sheet_used_or_filename)
    if path.suffix.lower() in (".xlsx", ".xls"):
        xls = pd.ExcelFile(path)
        sheet = best_sheet_for_excel(xls, cfg.get("synonyms", {}), cfg.get("sheet_priority", []))
        df = pd.read_excel(xls, sheet_name=sheet)
        return df, sheet
    elif path.suffix.lower() == ".csv":
        df = pd.read_csv(path)
        return df, path.name
    else:
        raise SystemExit(f"Unsupported file type: {path.suffix}")

def normalize_headers(df: pd.DataFrame) -> pd.DataFrame:
    # make headers easy to match (lowercase, underscores)
    return df.rename(columns={c: slug(str(c)) for c in df.columns})

def pick_first_present(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    for c in candidates:
        cc = slug(c)
        if cc in df.columns:
            return cc
    return None

def time_like_to_seconds(v) -> Optional[float]:
    if pd.isna(v): return None
    # when Excel duration is a time object (hh:mm:ss)
    if isinstance(v, time):
        return v.hour*3600 + v.minute*60 + v.second
    # numeric durations (often LOI minutes)
    try:
        f = float(v)
        # assume minutes if <= 300; else assume seconds
        return f*60 if f <= 300 else f
    except Exception:
        return None

def to_datetime(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce", dayfirst=True)

def compute_duration(df: pd.DataFrame, dur_col: Optional[str], start_col: Optional[str], end_col: Optional[str]) -> pd.Series:
    s = pd.Series([pd.NA]*len(df))
    # 1) direct duration column
    if dur_col:
        s = df[dur_col].apply(time_like_to_seconds)
    # 2) from start/end
    if start_col and end_col:
        mask = pd.isna(s)
        delta = (to_datetime(df[end_col]) - to_datetime(df[start_col])).dt.total_seconds()
        s = s.where(~mask, delta)
    return s

def yes_no_to_status(v) -> Optional[str]:
    if pd.isna(v): return None
    sv = str(v).strip().lower()
    if sv in ("true","1","yes","y"): return "completed"
    if sv in ("false","0","no","n"): return "incomplete"
    return str(v)

# ---------- main transform ----------

def transform(df: pd.DataFrame, cfg: Dict[str, Any]) -> Dict[str, Any]:
    syn = {k: [slug(x) for x in v] for k, v in (cfg.get("synonyms") or {}).items()}
    df = normalize_headers(df)

    # choose columns by first match
    get = lambda key: pick_first_present(df, syn.get(key, []))

    respondent_id = get("respondent_id")
    response_id   = get("response_id")
    survey_id     = get("survey_id")
    project_id    = get("project_id")
    region        = get("region")
    researcher_id = get("researcher_id")
    start_time    = get("start_time")
    end_time      = get("end_time")
    status        = get("status")
    duration_col  = get("duration_sec")

    out = pd.DataFrame(index=df.index)

    if respondent_id: out["respondent_id"] = df[respondent_id]
    if response_id:   out["response_id"]   = df[response_id]
    if survey_id:     out["survey_id"]     = df[survey_id]
    if project_id:    out["project_id"]    = df[project_id]
    if region:        out["region"]        = df[region]
    if researcher_id: out["researcher_id"] = df[researcher_id]

    # status
    if status:
        out["status"] = df[status].map(yes_no_to_status)
    else:
        out["status"] = pd.NA

    # times & duration
    if start_time: out["start_time"] = to_datetime(df[start_time])
    if end_time:   out["end_time"]   = to_datetime(df[end_time])
    out["duration_sec"] = compute_duration(df, duration_col, start_time, end_time)

    # features for the dashboard
    out["is_complete"] = out["status"].astype(str).str.lower().str.contains("complete").astype("Int64")
    if "start_time" in out.columns:
        out["start_date"] = out["start_time"].dt.date
        out["start_hour"] = out["start_time"].dt.hour

    # clean up obvious issues
    out = out.drop_duplicates()
    if "duration_sec" in out.columns:
        out.loc[out["duration_sec"] < 0, "duration_sec"] = pd.NA
        out.loc[out["duration_sec"] > 8*3600, "duration_sec"] = pd.NA

    # metrics for the KPIs
    total = len(out)
    completed = int(out["is_complete"].sum(skipna=True)) if "is_complete" in out.columns else 0
    completion_rate = round(100*completed/total, 2) if total else None

    metrics = {
        "rows_total": total,
        "rows_completed": completed,
        "completion_rate_pct": completion_rate,
        "by_region_top5": out["region"].value_counts(dropna=True).head(5).to_dict() if "region" in out.columns else {},
        "by_researcher_top5": out["researcher_id"].value_counts(dropna=True).head(5).to_dict() if "researcher_id" in out.columns else {},
        "generated_at": datetime.now(UTC).isoformat()
    }

    # daily summary (for charts later): total & completed per day
    if "start_date" in out.columns:
        by_day = out.groupby("start_date").agg(
            total=("start_date", "size"),
            completed=("is_complete", lambda s: int(s.sum(skipna=True)))
        ).reset_index()
    else:
        by_day = pd.DataFrame(columns=["start_date", "total", "completed"])

    return {"clean": out, "metrics": metrics, "by_day": by_day}

def run(input_path: Path, out_dir: Path, cfg_path: Path):
    cfg = read_config(cfg_path)
    files = list_files(input_path)

    all_rows: List[pd.DataFrame] = []
    all_by_day: List[pd.DataFrame] = []
    used = []

    for f in files:
        df, used_sheet = read_any(f, cfg)
        used.append(f"{f.name} :: {used_sheet}" if f.suffix.lower() in (".xlsx",".xls") else f.name)

        res = transform(df, cfg)
        res["clean"]["source_file"] = f.name
        all_rows.append(res["clean"])
        if not res["by_day"].empty:
            tmp = res["by_day"].copy()
            tmp["source_file"] = f.name
            all_by_day.append(tmp)

        # write/append audit as we go
        audit_line = {
            "timestamp": datetime.now(UTC).isoformat(),
            "action": "transform_v1",
            "file": f.name,
            "sheet": used_sheet,
            "rows": len(res["clean"])
        }
        (out_dir / "audit_log.csv").parent.mkdir(parents=True, exist_ok=True)
        pd.DataFrame([audit_line]).to_csv(
            out_dir / "audit_log.csv",
            mode="a",
            index=False,
            header=not (out_dir / "audit_log.csv").exists()
        )

    # safer concat to avoid the pandas futurewarning
    frames = [f for f in all_rows if not f.empty]
    clean = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

    out_dir.mkdir(parents=True, exist_ok=True)
    clean.to_csv(out_dir / "clean.csv", index=False)
    try:
        clean.to_parquet(out_dir / "clean.parquet", index=False)
    except Exception:
        pass  # pyarrow missing or not wanted is fine

    # write combined daily summary
    if all_by_day:
        day_frames = [d for d in all_by_day if not d.empty]
        by_day_all = pd.concat(day_frames, ignore_index=True) if day_frames else pd.DataFrame(columns=["start_date","total","completed","source_file"])
        by_day_all.to_csv(out_dir / "daily_summary.csv", index=False)

    # combined metrics (very simple)
    total = len(clean)
    completed = int(clean.get("is_complete", pd.Series([0]*total)).sum()) if total else 0
    metrics = {
        "rows_total": total,
        "rows_completed": completed,
        "completion_rate_pct": round(100*completed/total, 2) if total else None,
        "files_processed": used,
        "generated_at": datetime.now(UTC).isoformat()
    }
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics, indent=2))

def main():
    ap = argparse.ArgumentParser(description="EBRS data transform (simple & flexible)")
    ap.add_argument("--in", dest="input_path", required=True, help="file or folder")
    ap.add_argument("--out", dest="out_dir", required=True, help="output folder")
    ap.add_argument("--config", dest="config", default="data-pipeline/transform/config.yaml")
    args = ap.parse_args()

    run(Path(args.input_path), Path(args.out_dir), Path(args.config))

if __name__ == "__main__":
    main()
