import { Card } from "../../components/ui";

export default function Announcements() {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Latest</div>
        <ul className="list-disc list-inside text-sm text-zinc-600 space-y-1">
          <li>Training session on Friday, 10 AM</li>
          <li>Region C surveys due by next week</li>
        </ul>
      </Card>
    </div>
  );
}
