// LineTimeseries.jsx
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

export default function LineTimeseries({ series = [], height = 260 }) {
  // series: [{name:'Actual', data:[{date:'2025-10-18', value:12}, ...]}, {name:'Forecast', data:[...]}]
  // Flatten to a wide format by date
  const allDates = Array.from(new Set(series.flatMap(s => s.data.map(d => d.date)))).sort();
  const rows = allDates.map(date => {
    const obj = { date };
    series.forEach(s => {
      const hit = s.data.find(d => d.date === date);
      obj[s.name] = hit ? hit.value : null;
    });
    return obj;
  });

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          {series.map((s, i) => (
            <Line key={s.name} type="monotone" dataKey={s.name} dot={false} strokeWidth={2} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}