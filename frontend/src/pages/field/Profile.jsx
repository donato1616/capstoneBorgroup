import { Card } from "../../components/ui";

export default function Profile({ user }) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Profile</div>
        <div className="text-sm text-zinc-600">
          <div><span className="font-medium">Name:</span> {user.name}</div>
          <div><span className="font-medium">Email:</span> {user.email || "—"}</div>
          <div><span className="font-medium">Role:</span> Field Researcher</div>
        </div>
      </Card>
    </div>
  );
}
