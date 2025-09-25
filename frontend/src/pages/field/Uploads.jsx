import { Card } from "../../components/ui";

export default function Uploads() {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Upload Data</div>
        <div className="h-28 rounded-xl border border-dashed grid place-items-center text-xs text-zinc-500">
          CSV/JSON upload widget here (reusable from Overview if you like)
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Upload History</div>
        <div className="h-24 rounded-xl border border-dashed grid place-items-center text-xs text-zinc-500">
          Simple table of previous uploads (filename, time, status)
        </div>
      </Card>
    </div>
  );
}
