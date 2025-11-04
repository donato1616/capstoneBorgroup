#!/usr/bin/env python3
import argparse, os, json
import pandas as pd
from sqlalchemy import create_engine, text

FREQ_TO_DATE_TRUNC = {"D": "day", "W": "week", "M": "month"}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db-url", default=os.getenv("DATABASE_URL"))
    ap.add_argument("--dataset-name", default="FSR_Taiwan")  # matches public.datasets.name
    ap.add_argument("--freq", default="D", choices=["D","W","M"])
    ap.add_argument("--tz", default="Asia/Manila")
    ap.add_argument("--out-dataset", default="FSR_Taiwan", help="folder name under analytics_out")
    args = ap.parse_args()

    if not args.db_url:
        raise SystemExit("Missing DATABASE_URL (env or --db-url).")

    bucket = FREQ_TO_DATE_TRUNC[args.freq]

    # Count completed sessions only (Power BI logic)
    sql = text(f"""
        SELECT
          (date_trunc(:bucket, (r.created_at AT TIME ZONE :tz))::date) AS bucket_date,
          SUM(CASE WHEN r.is_complete THEN 1 ELSE 0 END)::bigint AS responses
        FROM public.responses r
        LEFT JOIN public.datasets d ON d.id = r.dataset_id
        LEFT JOIN public.studies  s ON s.id = r.study_id
        WHERE
          (d.name = :dataset_name) OR
          (s.name = :dataset_name) OR
          (r.source_file ILIKE ('%' || :dataset_name || '%'))
        GROUP BY 1
        ORDER BY 1
    """)

    engine = create_engine(args.db_url)
    with engine.begin() as conn:
        df = pd.read_sql_query(
            sql, conn,
            params={"bucket": bucket, "tz": args.tz, "dataset_name": args.dataset_name},
            parse_dates=["bucket_date"]
        )

    if df.empty:
        payload = {
            "kpi": {"title": "Total Responses (Completed)", "value": 0, "delta": 0, "freq": args.freq},
            "series": [],
            "meta": {"dataset": args.out_dataset, "filter_name": args.dataset_name, "tz": args.tz}
        }
    else:
        df = df.sort_values("bucket_date").reset_index(drop=True)
        total = int(df["responses"].sum())
        last = int(df.iloc[-1]["responses"])
        prev = int(df.iloc[-2]["responses"]) if len(df) >= 2 else 0
        payload = {
            "kpi": {"title": "Total Responses (Completed)", "value": total, "delta": last - prev, "freq": args.freq},
            "series": [{"x": d.strftime("%Y-%m-%d"), "y": int(v)} for d, v in zip(df["bucket_date"], df["responses"])],
            "meta": {
                "dataset": args.out_dataset, "filter_name": args.dataset_name, "tz": args.tz,
                "joins": ["public.datasets.name", "public.studies.name", "responses.source_file"]
            }
        }

    outdir = os.path.join("analytics_out", args.out_dataset, "kpi")
    os.makedirs(outdir, exist_ok=True)
    outpath = os.path.join(outdir, "total_responses.json")
    with open(outpath, "w", encoding="utf-8") as f: json.dump(payload, f, ensure_ascii=False)
    print("Wrote", outpath)

if __name__ == "__main__":
    main()
