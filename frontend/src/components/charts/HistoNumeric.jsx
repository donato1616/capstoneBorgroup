// frontend/src/components/charts/HistoNumeric.jsx
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell
  } from "recharts";
  
  export default function HistoNumeric({ bins = [], height = 220, barColor }) {
    const data = (bins || []).map(b => ({
      name: `${(Math.round(b.lo*100)/100)}–${(Math.round(b.hi*100)/100)}`,
      value: b.count
    }));
    if (!data.length) return <div className="text-sm text-zinc-500">No numeric data.</div>;
    return (
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 30 }}> {/* Increased bottom margin */}
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="name" 
              interval={0} 
              tick={{ fontSize: 11, angle: -45, textAnchor: 'end' }} 
              height={60} // Increased height for rotated labels
            />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value">
              {data.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={barColor ? barColor(index, data.length) : "#8884d8"} 
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }