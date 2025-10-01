import { Card } from "../../components/ui";

export default function FieldHome({ user }) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-zinc-900">
        Welcome, {user.name}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Today’s Goal</div>
          <p className="text-sm text-zinc-600">Complete 20 surveys in Region B.</p>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Progress</div>
          <p className="text-sm text-zinc-600">7 / 20 completed</p>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Next Check-in</div>
          <p className="text-sm text-zinc-600">Friday, 10:00 AM (Zoom)</p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Quick Upload</div>
        <div className="h-24 rounded-xl border border-dashed grid place-items-center text-xs text-zinc-500">
          Upload form / mobile sync goes here
        </div>
      </Card>
    </div>
  );
}
