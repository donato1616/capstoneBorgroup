import { Card } from "../../components/ui";

export default function AnalystProfile({ user }) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Profile</div>
        <div className="text-sm text-zinc-700">
          <div><span className="text-zinc-500">Name:</span> <span className="font-medium">{user?.name || "—"}</span></div>
          <div><span className="text-zinc-500">Email:</span> <span className="font-medium">{user?.email || "—"}</span></div>
          <div><span className="text-zinc-500">Role:</span> <span className="font-medium">Analyst</span></div>
        </div>
      </Card>
    </div>
  );
}
