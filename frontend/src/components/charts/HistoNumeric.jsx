// frontend/src/components/charts/HistoNumeric.jsx
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid
  } from "recharts";
  
  export default function HistoNumeric({ bins = [], height = 220 }) {
    const data = (bins || []).map(b => ({
      name: `${(Math.round(b.lo*100)/100)}–${(Math.round(b.hi*100)/100)}`,
      value: b.count
    }));
    if (!data.length) return <div className="text-sm text-zinc-500">No numeric data.</div>;
    return (
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" interval={0} tick={{ fontSize: 11 }} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }