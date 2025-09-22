import { Card } from "../../components/ui";

export default function DataExplorer() {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Explorer</div>
        <div className="h-60 rounded-xl border border-dashed grid place-items-center text-xs text-zinc-500">
          Grid / chart placeholder (drilldown, filters)
        </div>
      </Card>
    </div>
  );
}
