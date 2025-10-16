// src/context/DatasetContext.jsx
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { API_BASE } from "../lib/api";

const DatasetCtx = createContext(null);

export function DatasetProvider({ children }) {
  const [datasets, setDatasets] = useState([]);
  const [selected, setSelected] = useState("");   // dataset_id (UUID)
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/datasets`, { credentials: "include" });
        const data = await res.json();
        setDatasets(Array.isArray(data) ? data : []);
        // auto-select first if none
        if (!selected && data?.length) setSelected(data[0].dataset_id);
      } catch (e) {
        console.error("datasets load failed", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const value = useMemo(() => ({
    datasets, selected, setSelected, loading
  }), [datasets, selected, loading]);

  return <DatasetCtx.Provider value={value}>{children}</DatasetCtx.Provider>;
}

export function useDataset() {
  const ctx = useContext(DatasetCtx);
  if (!ctx) throw new Error("useDataset must be used within <DatasetProvider>");
  return ctx;
}
