import { Card } from "../../components/ui";

export default function AdminProfile({ user }) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-zinc-900">Profile</h1>

      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-zinc-700">
          <div>
            <div className="text-zinc-500 mb-1">Name</div>
            <div className="font-medium">{user?.name || "—"}</div>
          </div>
          <div>
            <div className="text-zinc-500 mb-1">Role</div>
            <div className="font-medium">Admin</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
