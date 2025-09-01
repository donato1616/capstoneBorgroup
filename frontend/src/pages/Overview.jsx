import { Card, KPI, Filter } from "../components/ui";

export default function Overview() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Filter label="Client" /><Filter label="Project" />
        <Filter label="Survey" /><Filter label="Date Range" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Total Responses" value="5,845" sub="Last sync: 15m ago" />
        <KPI label="Completion Rate" value="78%" sub="Target: 85%" />
        <KPI label="Error Rate" value="2%" sub="↓ from 3%" />
        <KPI label="Active Researchers" value="25" sub="/ 50 total" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartBox title="Daily Submissions" />
        <ChartBox title="Completion Forecast" />
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Key Predictive Highlights</div>
          <ul className="text-sm space-y-2 list-disc list-inside text-zinc-600">
            <li>Top Expected Segment: Panel 1 (↑ 12%)</li>
            <li>Risk: Region C low traction</li>
            <li>Next Best Action: Weekend pushes in Region B</li>
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Data Health Snapshot</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>Missing fields <span className="font-semibold">0.8%</span></div>
            <div>Duplicates <span className="font-semibold">12</span></div>
            <div>Outliers flagged <span className="font-semibold">7</span></div>
            <div>Last ETL <span className="font-semibold">02:14</span></div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Survey Selection</div>
          <div className="h-24 rounded-xl border border-dashed grid place-items-center text-xs text-zinc-500">
            Dropdown / multi-select placeholder
          </div>
        </Card>
      </div>
    </div>
  );
}
function ChartBox({ title }) {
  return (
    <div className="card p-4 h-64">
      <div className="text-sm font-medium mb-3">{title}</div>
      <div className="h-full grid place-items-center text-zinc-400">
        <div className="rounded-xl border border-dashed px-4 py-2 text-xs">Chart placeholder</div>
      </div>
    </div>
  );
}
