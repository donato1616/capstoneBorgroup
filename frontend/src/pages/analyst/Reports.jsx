import { Card } from "../../components/ui";

export default function Reports() {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-medium mb-3">Saved Reports</div>
        <div className="h-28 rounded-xl border border-dashed grid place-items-center text-xs text-zinc-500">
          Table of saved reports (name, created, owner, download)
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-medium mb-3">Recent Exports</div>
        <div className="h-28 rounded-xl border border-dashed grid place-items-center text-xs text-zinc-500">
          Export history (CSV, PDF)
        </div>
      </Card>
    </div>
  );
}
