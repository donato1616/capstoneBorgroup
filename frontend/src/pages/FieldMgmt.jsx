import { Card, Filter } from "../components/ui";

export default function FieldMgmt() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Filter label="Role" /><Filter label="Project" />
        <div className="ml-auto" />
        <button className="btn btn-primary">Add Researcher</button>
      </div>

      <Card>
        <div className="p-4 border-b border-zinc-200 flex items-center justify-between">
          <div className="text-sm font-medium">Researchers</div>
          <div className="text-xs text-zinc-500">Showing 1–10 of 50</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr className="border-b border-zinc-200">
                <th className="p-3">Name</th>
                <th className="p-3">Email</th>
                <th className="p-3">Role</th>
                <th className="p-3">Assigned Projects</th>
                <th className="p-3">Status</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-3">Sample Name {i+1}</td>
                  <td className="p-3">email{i+1}@ebrscorp.com</td>
                  <td className="p-3">FR</td>
                  <td className="p-3">2</td>
                  <td className="p-3"><span className="chip">Active</span></td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button className="btn btn-ghost">Edit</button>
                      <button className="btn btn-ghost">Suspend</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
