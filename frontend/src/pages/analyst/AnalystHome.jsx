import { Card } from "../../components/ui";

export default function AnalystHome({ user }) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-zinc-900">Welcome, {user.name}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Latest Report</div>
          <p className="text-sm text-zinc-600">“Weekly Completion Summary” (Sep 15–21)</p>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Scheduled Jobs</div>
          <p className="text-sm text-zinc-600">2 report generators queued</p>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Data Health</div>
          <p className="text-sm text-zinc-600">0 blocking issues detected</p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Quick Actions</div>
        <ul className="list-disc list-inside text-sm text-zinc-600 space-y-1">
          <li>Generate “Completion by Region” report</li>
          <li>Open Data Explorer for outliers</li>
        </ul>
      </Card>
    </div>
  );
}
