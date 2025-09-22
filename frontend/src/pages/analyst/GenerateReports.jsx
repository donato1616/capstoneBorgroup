import { Card } from "../../components/ui";

export default function GenerateReports() {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Report Builder</div>
        <div className="text-sm text-zinc-600">
          Choose dataset, dimensions, metrics, and filters.
        </div>
        <div className="mt-3 h-36 rounded-xl border border-dashed grid place-items-center text-xs text-zinc-500">
          Builder UI placeholder (pickers, date range, segments)
        </div>
        <div className="mt-3">
          <button className="rounded-xl bg-olive-700 px-4 py-2 text-sm font-medium text-white hover:bg-olive-800">
            Generate
          </button>
        </div>
      </Card>
    </div>
  );
}
