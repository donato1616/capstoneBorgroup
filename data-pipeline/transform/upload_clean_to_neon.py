import os, io
import pandas as pd
import psycopg2
from dotenv import load_dotenv

# Load env (will find ../backend/.env if you run from data-pipeline/)
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", "backend", ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
CSV_PATH = os.getenv("CSV_PATH", "C:/CAPSTONE/capstoneBorgroup/data/clean/clean.csv")
TABLE = "staging.clean_consolidated"

TRUE_SET = {"true","1","yes","y","t"}

def to_bool(v):
    if pd.isna(v): return None
    return str(v).strip().lower() in TRUE_SET

def main():
    df = pd.read_csv(CSV_PATH)

    # Casts to match table
    if "is_complete" in df.columns:
        df["is_complete"] = df["is_complete"].map(to_bool)

    for c in ["duration_sec","start_hour"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").astype("Int64")

    if "start_time" in df.columns:
        df["start_time"] = pd.to_datetime(df["start_time"], errors="coerce", utc=True)
    if "end_time" in df.columns:
        df["end_time"]   = pd.to_datetime(df["end_time"], errors="coerce", utc=True)
    if "start_date" in df.columns:
        df["start_date"] = pd.to_datetime(df["start_date"], errors="coerce").dt.date

    cols = ["status","duration_sec","is_complete","source_file","respondent_id",
            "region","researcher_id","start_time","end_time","start_date","start_hour"]

    # Ensure the file has exactly these columns
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise RuntimeError(f"clean.csv is missing columns: {missing}")

    df = df[cols]

    with psycopg2.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(f"TRUNCATE {TABLE};")
            buf = io.StringIO()
            df.to_csv(buf, index=False, header=False)
            buf.seek(0)
            cur.copy_expert(
                f"COPY {TABLE} ({','.join(cols)}) FROM STDIN WITH (FORMAT CSV)",
                buf
            )
        conn.commit()
    print(f"✅ Uploaded {len(df):,} rows to {TABLE}")

if __name__ == "__main__":
    main()
