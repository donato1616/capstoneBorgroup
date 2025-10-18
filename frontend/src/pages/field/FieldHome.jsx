import { useEffect, useState } from "react";
import { Card } from "../../components/ui";

export default function FieldHome({ user }) {
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Placeholder backend call
    async function fetchData() {
      try {
        const res = await fetch(`http://localhost:3001/api/field/dashboard/${user.id}`);
        const data = await res.json();
        setDashboardData(data);
      } catch (err) {
        console.error("Failed to load dashboard:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [user.id]);

  if (loading) return <p className="text-sm text-zinc-500">Loading dashboard...</p>;
  if (!dashboardData) return <p className="text-sm text-red-500">No data available.</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-zinc-900">
        Welcome, {user.name}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Today’s Goal</div>
          <p className="text-sm text-zinc-600">
            {dashboardData.goal || "No goal assigned."}
          </p>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Progress</div>
          <p className="text-sm text-zinc-600">
            {dashboardData.progress
              ? `${dashboardData.progress.completed} / ${dashboardData.progress.target} completed`
              : "No progress data."}
          </p>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Next Check-in</div>
          <p className="text-sm text-zinc-600">
            {dashboardData.nextCheckin || "No schedule yet."}
          </p>
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