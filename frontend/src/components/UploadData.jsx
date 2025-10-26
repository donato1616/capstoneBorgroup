// frontend/src/components/UploadData.jsx
import { useRef, useState } from "react";
import { Card } from "./ui";

export default function UploadData() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | uploading | success | error
  const [message, setMessage] = useState("");

  const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5050";
  const UPLOAD_URL = `${API_BASE}/api/dataset/upload`;

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
    const name = f.name.toLowerCase();
    const isCsv = name.endsWith(".csv");
    const isXlsx = name.endsWith(".xlsx") || name.endsWith(".xls");
    if (!isCsv && !isXlsx) {
      setStatus("error");
      setMessage("Unsupported file type. Please upload a .csv or .xlsx file.");
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
      setMessage("Uploading and processing...");

      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name);

      const res = await fetch(UPLOAD_URL, { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || "Upload failed");

      setStatus("success");
        setMessage(`Uploaded. Inserted facts: ${data.inserted_facts}. Issues: ${data.issues_count}.`);
        if (data?.dataset_id) {
          localStorage.setItem("current_dataset_id", String(data.dataset_id));
          // let others (DatasetSelector / Overview) know about the new dataset
          window.dispatchEvent(new CustomEvent('dataset:uploaded', { detail: { id: String(data.dataset_id) } }));
        }
        setFile(null);
    } catch (err) {
      console.error(err);
      setStatus("error");
      setMessage(err.message || "Upload failed.");
    }
  };

  return (
    <div className="col-span-1">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Data Import</div>
            <p className="text-xs text-zinc-500 mt-1">Upload new datasets for analysis</p>
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
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={onFilePick}
            />
          </div>
        </div>

        {file && (
          <div className="mt-3 rounded-xl border p-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">
                  <span className="font-medium">{file.name}</span>{" "}
                  <span className="text-xs text-zinc-500">({(file.size / 1024).toFixed(1)} KB)</span>
                </div>
              </div>
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
  );
}
