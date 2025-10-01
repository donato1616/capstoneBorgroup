// src/pages/FieldDashboard.jsx
import { Card } from "../../components/ui";

export default function FieldDashboard({ user }) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-zinc-900">
        Welcome, {user.name}
      </h1>

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Survey Submissions</div>
        <p className="text-sm text-zinc-600">
          Here you can upload and track your survey responses.
        </p>
        <div className="mt-3 h-24 rounded-xl border border-dashed grid place-items-center text-xs text-zinc-500">
          Upload form / mobile sync goes here
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Announcements</div>
        <ul className="list-disc list-inside text-sm text-zinc-600 space-y-1">
          <li>Training session on Friday, 10 AM</li>
          <li>Region C surveys due by next week</li>
        </ul>
      </Card>
    </div>
  );
}
