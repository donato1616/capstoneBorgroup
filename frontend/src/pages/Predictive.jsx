import { Card, Filter } from "../components/ui";
export default function Predictive() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Filter label="Model" /><Filter label="Target" /><Filter label="Date Range" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Chart title="Linear Regression" />
        <Chart title="Logistic Regression" />
        <Chart title="Time-Series Forecast" />
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Model KPIs</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>MSE <span className="font-semibold">0.132</span></div>
            <div>MAPE <span className="font-semibold">8.4%</span></div>
            <div>R² <span className="font-semibold">0.79</span></div>
            <div>Accuracy <span className="font-semibold">86%</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
function Chart({ title }) {
  return (
    <div className="card p-4 h-64">
      <div className="text-sm font-medium mb-3">{title}</div>
      <div className="h-full grid place-items-center text-zinc-400">
        <div className="rounded-xl border border-dashed px-4 py-2 text-xs">Chart placeholder</div>
      </div>
    </div>
  );
}
