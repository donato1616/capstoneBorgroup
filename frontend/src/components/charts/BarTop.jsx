// Simple top-N horizontal bars (Recharts)
import React from "react";
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip
} from "recharts";

export default function BarsTopN({
  data = [],           // [{label, value}]
  height = 260
}) {
  // Recharts wants field names; adapt
  const rows = (data || []).map(d => ({ name: d.label, count: d.value }));
  return (
    <div style={{width:"100%", height}}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{left: 40}}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" />
          <YAxis type="category" dataKey="name" width={140}/>
          <Tooltip />
          <Bar dataKey="count" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
