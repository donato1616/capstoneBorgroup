import { Card } from "../../components/ui";

export default function Assignments() {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Upcoming Assignments</div>
        <ul className="text-sm text-zinc-600 space-y-1 list-disc list-inside">
          <li>Region C — Saturday pilot (10 respondents)</li>
          <li>Mall Intercepts — Sunday afternoon</li>
        </ul>
      </Card>
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Completed</div>
        <div className="text-sm text-zinc-600">None yet</div>
      </Card>
    </div>
  );
}
