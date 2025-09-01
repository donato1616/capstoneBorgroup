import { Filter } from "../components/ui";
export default function Completion() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Filter label="Project" /><Filter label="Survey" /><Filter label="Date Range" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Chart title="Completion Progress Over Time" />
        <Chart title="By Location" />
        <Chart title="By Field Researcher" />
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
