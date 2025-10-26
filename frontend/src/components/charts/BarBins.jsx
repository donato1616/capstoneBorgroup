import React from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

export default function BarBins({ bins = [], height = 220 }) {
  const data = (bins || []).map(b => ({
    label: `[${Number(b.lo).toFixed(2)} - ${Number(b.hi).toFixed(2)}]`,
    count: b.count
  }));
  return (
    <div className="rounded-xl border p-3">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" hide />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
