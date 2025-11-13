// BarSimple.jsx
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";

// Function to truncate long text
const truncateLabel = (label, maxLength = 20) => {
  if (label.length <= maxLength) return label;
  return label.substring(0, maxLength) + '...';
};

// Custom tooltip
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-2 border rounded shadow-sm text-sm">
        <p className="font-medium">{label}</p>
        <p>Value: {payload[0].value}</p>
      </div>
    );
  }
  return null;
};

export default function BarSimple({ data = [], xKey = "label", yKey = "value", height = 240, barColor }) {
  const processedData = data.map(item => ({
    ...item,
    displayLabel: truncateLabel(item[xKey])
  }));

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={processedData} margin={{ top: 8, right: 16, left: 0, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="displayLabel" 
            tick={{ fontSize: 12, angle: -45, textAnchor: 'end' }} 
            height={60}
          />
          <YAxis allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey={yKey}>
            {processedData.map((entry, index) => (
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