import { Card, Filter } from "../components/ui";
export default function AuditTrail() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Filter label="Date Range" /><Filter label="User" />
        <Filter label="Action" /><Filter label="Dataset" />
      </div>
      <Card>
        <div className="p-4 border-b border-zinc-200 text-sm font-medium">Audit Trail</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr className="border-b border-zinc-200">
                <th className="p-3">Timestamp</th>
                <th className="p-3">User</th>
                <th className="p-3">Action</th>
                <th className="p-3">Extent</th>
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 7 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-3">08/16/25 12:{30+i}</td>
                  <td className="p-3">FR12</td>
                  <td className="p-3">Remove Duplicates</td>
                  <td className="p-3">Master FBF</td>
                  <td className="p-3">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
