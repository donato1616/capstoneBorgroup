// frontend/src/pages/FieldResearcher.jsx
export default function FieldResearcherDashboard() {
    return (
      <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
        {/* Header */}
        <header className="flex justify-between items-center bg-white shadow p-4 rounded-2xl">
          <h1 className="text-xl font-bold">Hello, Field Researcher 👋</h1>
          <div className="flex space-x-4">
            <button className="text-gray-600">🔔</button>
            <button className="text-gray-600">❓</button>
            <button className="text-gray-600">⚙️</button>
          </div>
        </header>
  
        {/* Assigned Projects */}
        <section className="bg-white shadow p-4 rounded-2xl mt-6">
          <h2 className="text-lg font-semibold mb-3">Assigned Projects</h2>
          <table className="w-full text-sm">
            <thead className="text-left border-b">
              <tr>
                <th className="p-2">Project Name</th>
                <th className="p-2">Status</th>
                <th className="p-2">Deadline</th>
                <th className="p-2">Assigned</th>
                <th className="p-2">Completed</th>
                <th className="p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="p-2">Project A</td>
                <td className="p-2 text-yellow-600 font-medium">Ongoing</td>
                <td className="p-2">Aug 30</td>
                <td className="p-2">120</td>
                <td className="p-2">75</td>
                <td className="p-2"><button className="text-blue-600">View</button></td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    );
  }
  