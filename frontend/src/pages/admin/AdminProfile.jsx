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
            <div className="text-zinc-500 mb-1">Email</div>
            <div className="font-medium">{user?.email || "—"}</div>
          </div>
          <div>
            <div className="text-zinc-500 mb-1">Role</div>
            <div className="font-medium">Admin</div>
          </div>
          <div>
            <div className="text-zinc-500 mb-1">Last Login</div>
            <div className="font-medium">—</div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Security</div>
        <div className="text-sm text-zinc-600">
          • 2FA: <span className="font-medium">Not configured</span> <br />
          • Session token: stored in browser (demo)
        </div>
        <div className="mt-3 text-xs text-zinc-500">
          Tip: Replace demo auth with your API + JWT and add 2FA.
        </div>
      </Card>
    </div>
  );
}
