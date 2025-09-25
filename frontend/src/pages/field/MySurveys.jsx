import { Card } from "../../components/ui";

export default function MySurveys() {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Assigned Surveys</div>
        <ul className="text-sm text-zinc-600 space-y-1 list-disc list-inside">
          <li>Panel A — Urban Households</li>
          <li>Panel B — Students (18–24)</li>
          <li>Panel C — Weekend Shoppers</li>
        </ul>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Recent Submissions</div>
        <div className="h-24 rounded-xl border border-dashed grid place-items-center text-xs text-zinc-500">
          Table/list of recent survey IDs
        </div>
      </Card>
    </div>
  );
}
