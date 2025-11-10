// frontend/src/components/charts/LineTimeseries.jsx
import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

// Extended color palette for multiple categories
const COLOR_PALETTE = [
  "#0ea5e9", // sky-500
  "#6366f1", // indigo-500
  "#f59e0b", // amber-500
  "#10b981", // emerald-500
  "#ef4444", // red-500
  "#8b5cf6", // violet-500
  "#06b6d4", // cyan-500
  "#84cc16", // lime-500
  "#f97316", // orange-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
  "#a855f7", // purple-500
];

// Default colors for standard series types
const SERIES_COLORS = {
  Actual: "#0ea5e9",
  Fitted: "#6366f1",
  Forecast: "#f59e0b",
  Baseline: "#6b7280",
  Completed: "#10b981",
};

function mergeSeries(series) {
  const allDates = new Set();
  for (const s of series || []) {
    for (const p of s.data || []) allDates.add(p.date);
  }
  const rows = [...allDates].sort().map((date) => ({ date }));
  for (const s of series || []) {
    const map = new Map((s.data || []).map((d) => [d.date, d.value]));
    for (const r of rows) r[s.name] = map.get(r.date) ?? null;
  }
  return rows;
}

function transformSingleSeries(data, xKey, yKey, seriesName = "Completed") {
  if (!data || !data.length) return { series: [], data: [] };
  
  const series = [{
    name: seriesName,
    data: data.map(item => ({
      date: item[xKey],
      value: item[yKey]
    }))
  }];
  
  const mergedData = mergeSeries(series);
  return { series, data: mergedData };
}

// Function to assign colors to series based on their type and category
function assignSeriesColors(series) {
  const categoryMap = new Map();
  let categoryIndex = 0;
  
  return series.map(s => {
    // Check if this is a standard series type (Actual, Fitted, Forecast)
    const isStandardType = Object.keys(SERIES_COLORS).some(type => 
      s.name === type || s.name.startsWith(`${type}:`)
    );
    
    let color;
    
    if (isStandardType) {
      // For standard types, use the predefined colors
      const baseType = s.name.split(':')[0]; // Extract "Actual", "Fitted", or "Forecast"
      color = SERIES_COLORS[baseType] || SERIES_COLORS.Actual;
    } else {
      // For categorical data, assign colors based on the category
      const categoryName = s.name.split(':').pop()?.trim() || s.name;
      
      if (!categoryMap.has(categoryName)) {
        categoryMap.set(categoryName, COLOR_PALETTE[categoryIndex % COLOR_PALETTE.length]);
        categoryIndex++;
      }
      
      color = categoryMap.get(categoryName);
    }
    
    return {
      ...s,
      color,
      // Determine if this should be a dashed line (forecast lines)
      isDashed: s.name.includes("Forecast") || s.name === "Baseline"
    };
  });
}

export default function LineTimeseries({ 
  series = [], 
  data = [], 
  xKey = "date", 
  yKey = "value", 
  yLabel = "",
  seriesName = "Completed" 
}) {
  // Handle both old format (data, xKey, yKey) and new format (series)
  const { transformedSeries, transformedData } = useMemo(() => {
    if (series && series.length > 0) {
      return {
        transformedSeries: series,
        transformedData: mergeSeries(series)
      };
    } else if (data && data.length > 0) {
      const result = transformSingleSeries(data, xKey, yKey, seriesName);
      return {
        transformedSeries: result.series,
        transformedData: result.data
      };
    }
    return { transformedSeries: [], transformedData: [] };
  }, [series, data, xKey, yKey, seriesName]);

  // Assign colors to the series
  const coloredSeries = useMemo(() => {
    return assignSeriesColors(transformedSeries);
  }, [transformedSeries]);

  if (!transformedData.length) {
    return <div className="text-sm text-zinc-500">No time series data.</div>;
  }

  return (
    <div className="w-full h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={transformedData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="date" 
            tick={{ fontSize: 12 }}
            tickFormatter={(value) => {
              try {
                const date = new Date(value);
                return date.toLocaleDateString();
              } catch {
                return value;
              }
            }}
          />
          <YAxis 
            tick={{ fontSize: 12 }} 
            label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", offset: 8 } : undefined}
          />
          <Tooltip 
            labelFormatter={(value) => {
              try {
                const date = new Date(value);
                return date.toLocaleDateString();
              } catch {
                return value;
              }
            }}
          />
          <Legend />

          {/* Draw lines with assigned colors */}
          {coloredSeries.map((s) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              dot={{ fill: s.color, r: 3 }}
              strokeWidth={2}
              strokeDasharray={s.isDashed ? "6 6" : "0"}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}