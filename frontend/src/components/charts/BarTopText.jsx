// frontend/src/components/charts/BarTopText.jsx
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid
  } from "recharts";
  
  export default function BarTopText({ items = [], height = 220 }) {
    const data = (items || []).map(r => ({ name: r.label, value: r.count }));
    if (!data.length) return <div className="text-sm text-zinc-500">No text data.</div>;
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