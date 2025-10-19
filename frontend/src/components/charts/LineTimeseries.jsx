// Simple reusable time-series line (Recharts)
import React from "react";
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip
} from "recharts";

export default function LineTimeseries({
  data = [],               // [{date:'YYYY-MM-DD', value: Number}]
  xKey = "date",
  yKey = "value",
  height = 260,
  yLabel = ""
}) {
  const fmtX = (v) => v ? String(v).slice(5) : "";
  return (
    <div style={{width:"100%", height}}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey} tickFormatter={fmtX} />
          <YAxis label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft'} : null}/>
          <Tooltip />
          <Line type="monotone" dataKey={yKey} dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
