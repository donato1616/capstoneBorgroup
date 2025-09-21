import { useEffect, useRef, useState } from "react";
import { Card, KPI, Filter } from "../../components/ui";

const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString());

export default function Overview() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);

  // build the URL safely (respects vite base)
  const METRICS_URL = `${import.meta.env.BASE_URL}data/clean/metrics.json`;

  useEffect(() => {
    fetch(METRICS_URL, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${METRICS_URL}`);
        return r.json();
      })
      .then((data) => {
        console.log("Loaded metrics.json:", data);
        setMetrics(data);
        setError(null);
      })
      .catch((err) => {
        console.error("Failed to load metrics.json", err);
        setMetrics(null);
        setError("No metrics found. Make sure metrics.json is in /public/data/clean/");
      });
  }, [METRICS_URL]);

  const lastSync = metrics?.generated_at
    ? new Date(metrics.generated_at).toLocaleString()
    : "—";
  const total = metrics?.rows_total ?? null;
  const completion = metrics?.completion_rate_pct ?? null;

  return (
    <div className="space-y-6">
      {error && (
        <div className="chip bg-amber-50 border-amber-300 text-amber-800">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Filter label="Client" /><Filter label="Project" />
        <Filter label="Survey" /><Filter label="Date Range" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Total Responses" value={fmt(total)} sub={`Last sync: ${lastSync}`} />
        <KPI label="Completion Rate" value={completion == null ? "—" : `${completion}%`} sub="Target: 85%" />
        <KPI label="Error Rate" value="—" sub="(coming from QA checks)" />
        <KPI label="Active Researchers" value="—" sub="(coming soon)" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartBox title="Daily Submissions" />
        <ChartBox title="Completion Forecast" />
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Key Predictive Highlights</div>
          <ul className="text-sm space-y-2 list-disc list-inside text-zinc-600">
            <li>Top Expected Segment: Panel 1 (placeholder)</li>
            <li>Risk: Region C low traction (placeholder)</li>
            <li>Next Best Action: Weekend pushes in Region B (placeholder)</li>
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Data Health Snapshot</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>Missing fields <span className="font-semibold">—</span></div>
            <div>Duplicates <span className="font-semibold">—</span></div>
            <div>Outliers flagged <span className="font-semibold">—</span></div>
            <div>Last ETL <span className="font-semibold">{lastSync}</span></div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Survey Selection</div>
          <div className="h-24 rounded-xl border border-dashed grid place-items-center text-xs text-zinc-500">
            Dropdown / multi-select placeholder
          </div>
        </Card>
      </div>

      {/* ===== Upload Data (bottom) ===== */}
      <UploadData />
    </div>
  );
}

function ChartBox({ title }) {
  return (
    <div className="card p-4 h-64">
      <div className="text-sm font-medium mb-3">{title}</div>
      <div className="h-full grid place-items-center text-zinc-400">
        <div className="rounded-xl border border-dashed px-4 py-2 text-xs">Chart placeholder</div>
      </div>
    </div>
  );
}

//Upload Data component
function UploadData() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | uploading | success | error
  const [message, setMessage] = useState("");

  const API_BASE = import.meta.env.VITE_API_BASE || "";
  const UPLOAD_URL = `${API_BASE}/api/upload`;

  const onChoose = () => inputRef.current?.click();

  const onFilePick = (e) => {
    const f = e.target.files?.[0];
    if (f) validateAndSet(f);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) validateAndSet(f);
  };

  const validateAndSet = (f) => {
    const okTypes = [
      "text/csv",
      "application/vnd.ms-excel",
      "application/json",
      "text/plain"
    ];
    const isCsv = f.name.toLowerCase().endsWith(".csv");
    const isJson = f.name.toLowerCase().endsWith(".json");
    if (!okTypes.includes(f.type) && !isCsv && !isJson) {
      setStatus("error");
      setMessage("Unsupported file type. Please upload a .csv or .json file.");
      setFile(null);
      return;
    }
    setFile(f);
    setStatus("idle");
    setMessage("");
  };

  const onUpload = async () => {
    if (!file) return;
    try {
      setStatus("uploading");
      setMessage("Uploading…");

      const form = new FormData();
      form.append("file", file);

      const res = await fetch(UPLOAD_URL, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${txt || "Upload failed"}`);
      }

      const data = await res.json().catch(() => ({}));
      setStatus("success");
      setMessage(data?.message || "File uploaded successfully.");
      setFile(null);
    } catch (err) {
      console.error(err);
      setStatus("error");
      setMessage(err.message || "Upload failed.");
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      <div className="col-span-1">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Data Import</div>
              <p className="text-xs text-zinc-500 mt-1">
                Upload new datasets for analysis
              </p>
            </div>
          </div>

          <div
            className={[
              "mt-4 h-24 rounded-xl border-2 border-dashed grid place-items-center text-xs transition",
              isDragging ? "border-zinc-900 bg-zinc-50" : "border-zinc-300"
            ].join(" ")}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            <div className="text-center">
              <div className="font-medium">{isDragging ? "Drop to upload" : "Drag & drop file"}</div>
              <div className="text-[11px] text-zinc-500 mt-1">or</div>
              <button
                type="button"
                onClick={onChoose}
                className="mt-2 inline-flex items-center rounded-lg px-2.5 py-1 text-xs border bg-white hover:bg-zinc-50 shadow-sm"
              >
                Browse
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.json"
                className="hidden"
                onChange={onFilePick}
              />
            </div>
          </div>

          {file && (
            <div className="mt-3 rounded-xl border p-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                {/* filename (truncates nicely) */}
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">
                    <span className="font-medium">{file.name}</span>{" "}
                    <span className="text-xs text-zinc-500">({(file.size / 1024).toFixed(1)} KB)</span>
                  </div>
                </div>

                {/* actions */}
                <div className="flex items-center gap-2 sm:shrink-0">
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="text-xs px-2 py-1 rounded-lg border"
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    onClick={onUpload}
                    className="text-xs px-3 py-1.5 rounded-lg bg-zinc-900 text-white hover:opacity-90"
                  >
                    Upload
                  </button>
                </div>
              </div>
            </div>
          )}

          {status !== "idle" && (
            <div
              className={[
                "mt-3 text-sm rounded-xl px-3 py-2 border",
                status === "uploading" && "border-zinc-300 text-zinc-600",
                status === "success" && "border-emerald-300 bg-emerald-50 text-emerald-800",
                status === "error" && "border-rose-300 bg-rose-50 text-rose-800",
              ].join(" ")}
            >
              {status === "uploading" ? (
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-zinc-400 animate-pulse" />
                  {message || "Uploading…"}
                </div>
              ) : (
                message
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
