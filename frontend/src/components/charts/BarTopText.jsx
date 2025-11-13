// frontend/src/components/charts/BarTopText.jsx
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell
  } from "recharts";
  
  // Function to truncate long text
  const truncateLabel = (label, maxLength = 20) => {
    if (label.length <= maxLength) return label;
    return label.substring(0, maxLength) + '...';
  };
  
  // Custom tooltip to show full label
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-2 border rounded shadow-sm text-sm">
          <p className="font-medium">{label}</p>
          <p>Count: {payload[0].value}</p>
        </div>
      );
    }
    return null;
  };

  export default function BarTopText({ items = [], height = 220, barColor }) {
    const data = (items || []).map(r => ({ 
      name: r.label, 
      displayName: truncateLabel(r.label),
      value: r.count 
    }));
    
    if (!data.length) return <div className="text-sm text-zinc-500">No text data.</div>;
    
    return (
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="displayName" 
              interval={0} 
              tick={{ fontSize: 11, angle: -45, textAnchor: 'end' }} 
              height={60}
            />
            <YAxis />
            <Tooltip content={<CustomTooltip />} />
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