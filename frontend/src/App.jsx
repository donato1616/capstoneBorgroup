import { useEffect, useState } from "react";
import {
  Bell,
  Download,
  Grid2X2,
  Activity,
  LineChart,
  Users,
  History,
  Settings,
  LogOut,
  LayoutDashboard,
  ClipboardList,
  Upload as UploadIcon,
  Megaphone,
  UserCircle,
  FileText,
  FilePlus2,
  Database,
} from "lucide-react";

// Login page
import Login from "./pages/Login.jsx";

// Admin pages
import Overview from "./pages/admin/Overview.jsx";
import Completion from "./pages/admin/Completion.jsx";
import Predictive from "./pages/admin/Predictive.jsx";
import FieldMgmt from "./pages/admin/FieldMgmt.jsx";
import AuditTrail from "./pages/admin/AuditTrail.jsx";
import AdminProfile from "./pages/admin/AdminProfile.jsx";
import AdminDashboard from "./pages/admin/index.jsx";

// Field researcher pages
import FieldHome from "./pages/field/FieldHome.jsx";
import MySurveys from "./pages/field/MySurveys.jsx";
import Assignments from "./pages/field/Assignments.jsx";
import Uploads from "./pages/field/Uploads.jsx";
import Announcements from "./pages/field/Announcements.jsx";
import Profile from "./pages/field/Profile.jsx";

// Analyst pages
import AnalystHome from "./pages/analyst/AnalystHome.jsx";
import Reports from "./pages/analyst/Reports.jsx";
import GenerateReports from "./pages/analyst/GenerateReports.jsx";
import DataExplorer from "./pages/analyst/DataExplorer.jsx";
import AnalystProfile from "./pages/analyst/Profile.jsx";

import DatasetSelector from "./components/DatasetSelector.jsx";
import DatasetAnalytics from "./components/DatasetAnalytics.jsx";

import { Breadcrumb } from "./components/ui";
import clsx from "clsx";

export default function App() {
  // ====== Persistent tab states ======
  const [active, setActive] = useState(() => localStorage.getItem("admin_active") || "overview");
  const [activeField, setActiveField] = useState(() => localStorage.getItem("field_active") || "home");
  const [activeAnalyst, setActiveAnalyst] = useState(() => localStorage.getItem("analyst_active") || "a_home");

  // ====== User ======
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem("auth_user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (user) {
      localStorage.setItem("auth_user", JSON.stringify(user));
      if (!localStorage.getItem("auth_token")) {
        localStorage.setItem("auth_token", "demo-token");
      }
    } else {
      localStorage.removeItem("auth_user");
      localStorage.removeItem("auth_token");
    }
  }, [user]);

  // ====== Save active tab per role ======
  useEffect(() => { localStorage.setItem("admin_active", active); }, [active]);
  useEffect(() => { localStorage.setItem("field_active", activeField); }, [activeField]);
  useEffect(() => { localStorage.setItem("analyst_active", activeAnalyst); }, [activeAnalyst]);

  // ====== Reload last-used or default tab when role changes ======
  useEffect(() => {
    if (!user) return;

    if (user.role === "admin") {
      setActive(localStorage.getItem("admin_active") || "overview");
    }
    if (user.role === "field") {
      setActiveField(localStorage.getItem("field_active") || "home");
    }
    if (user.role === "analyst") {
      setActiveAnalyst(localStorage.getItem("analyst_active") || "a_home");
    }
  }, [user?.role]);

  // ====== Dataset selection (Admin Overview) ======
  const [selectedDataset, setSelectedDataset] = useState("");
  const [filters, setFilters] = useState({ region: "", isComplete: undefined });

  // ====== Logout ======
  function handleLogout() {
    // clear saved keys
    localStorage.removeItem("admin_active");
    localStorage.removeItem("field_active");
    localStorage.removeItem("analyst_active");
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_token");

    // 🔑 reset in-memory states so it applies immediately
    setActive("overview");
    setActiveField("home");
    setActiveAnalyst("a_home");

    setUser(null);
  }

  if (!user) return <Login onLogin={setUser} />;

  // ================= FIELD RESEARCHER =================
  if (user.role === "field") {
    return (
      <div className="flex h-screen w-full bg-zinc-50 text-zinc-900">
        {/* Sidebar (Field) */}
        <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-olive-700 text-white">
          <div className="px-4 py-4 flex items-center gap-3 border-b border-white/10">
            <div className="h-9 w-9 rounded-xl bg-white text-olive-700 grid place-items-center font-bold shadow-sm">EB</div>
            <div>
              <div className="text-sm font-semibold tracking-wide">EBRS Insights</div>
              <div className="text-xs text-white/80">Field Portal</div>
            </div>
          </div>

          <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
            <SideLink icon={<LayoutDashboard size={18} />} label="Dashboard" active={activeField === "home"} onClick={() => setActiveField("home")} />
            <SideLink icon={<ClipboardList size={18} />} label="My Surveys" active={activeField === "surveys"} onClick={() => setActiveField("surveys")} />
            <SideLink icon={<Users size={18} />} label="Assignments" active={activeField === "assignments"} onClick={() => setActiveField("assignments")} />
            <SideLink icon={<UploadIcon size={18} />} label="Uploads" active={activeField === "uploads"} onClick={() => setActiveField("uploads")} />
            <SideLink icon={<Megaphone size={18} />} label="Announcements" active={activeField === "announcements"} onClick={() => setActiveField("announcements")} />
            <div className="pt-2">
              <div className="px-3 text-[10px] uppercase tracking-wider text-white/70">Account</div>
              <SideLink icon={<UserCircle size={18} />} label="Profile" active={activeField === "profile"} onClick={() => setActiveField("profile")} />
            </div>
          </nav>

          <div className="px-3 py-4 border-t border-white/10">
            <div className="text-xs mb-1 text-white/80">Logged in as</div>
            <div className="text-sm font-medium">{user.name}</div>
          </div>
        </aside>

        {/* Main (Field) */}
        <div className="flex-1 flex min-w-0 flex-col">
          <header className="h-14 border-b border-zinc-200 bg-white/70 backdrop-blur px-4 flex items-center justify-between">
            <div className="text-sm text-zinc-600">
              Field Portal <span className="mx-1">›</span>
              <span className="font-medium text-zinc-900">{labelForField(activeField)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost"><Bell size={18} /></button>
              <button className="btn-ghost"><Download size={16} /> Export</button>
              <button className="btn-ghost text-rose-600" onClick={handleLogout}><LogOut size={16} /> Logout</button>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            {activeField === "home" && <FieldHome user={user} />}
            {activeField === "surveys" && <MySurveys user={user} />}
            {activeField === "assignments" && <Assignments user={user} />}
            {activeField === "uploads" && <Uploads user={user} />}
            {activeField === "announcements" && <Announcements user={user} />}
            {activeField === "profile" && <Profile user={user} />}
          </main>
        </div>
      </div>
    );
  }

  // ================= ANALYST =================
  if (user.role === "analyst") {
    return (
      <div className="flex h-screen w-full bg-zinc-50 text-zinc-900">
        <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-olive-700 text-white">
          <div className="px-4 py-4 flex items-center gap-3 border-b border-white/10">
            <div className="h-9 w-9 rounded-xl bg-white text-olive-700 grid place-items-center font-bold shadow-sm">EB</div>
            <div>
              <div className="text-sm font-semibold tracking-wide">EBRS Insights</div>
              <div className="text-xs text-white/80">Analyst Workspace</div>
            </div>
          </div>

          <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
            <SideLink icon={<LayoutDashboard size={18} />} label="Dashboard" active={activeAnalyst === "a_home"} onClick={() => setActiveAnalyst("a_home")} />
            <SideLink icon={<FileText size={18} />} label="Reports" active={activeAnalyst === "a_reports"} onClick={() => setActiveAnalyst("a_reports")} />
            <SideLink icon={<FilePlus2 size={18} />} label="Generate Reports" active={activeAnalyst === "a_generate"} onClick={() => setActiveAnalyst("a_generate")} />
            <SideLink icon={<Database size={18} />} label="Data Explorer" active={activeAnalyst === "a_data"} onClick={() => setActiveAnalyst("a_data")} />
            <div className="pt-2">
              <div className="px-3 text-[10px] uppercase tracking-wider text-white/70">Account</div>
              <SideLink icon={<UserCircle size={18} />} label="Profile" active={activeAnalyst === "a_profile"} onClick={() => setActiveAnalyst("a_profile")} />
            </div>
          </nav>

          <div className="px-3 py-4 border-t border-white/10">
            <div className="text-xs mb-1 text-white/80">Logged in as</div>
            <div className="text-sm font-medium">{user.name}</div>
          </div>
        </aside>

        <div className="flex-1 flex min-w-0 flex-col">
          <header className="h-14 border-b border-zinc-200 bg-white/70 backdrop-blur px-4 flex items-center justify-between">
            <div className="text-sm text-zinc-600">
              Analyst Workspace <span className="mx-1">›</span>
              <span className="font-medium text-zinc-900">{labelForAnalyst(activeAnalyst)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost"><Bell size={18} /></button>
              <button className="btn-ghost"><Download size={16} /> Export</button>
              <button className="btn-ghost text-rose-600" onClick={handleLogout}><LogOut size={16} /> Logout</button>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            {activeAnalyst === "a_home" && <AnalystHome user={user} />}
            {activeAnalyst === "a_reports" && <Reports />}
            {activeAnalyst === "a_generate" && <GenerateReports />}
            {activeAnalyst === "a_data" && <DataExplorer />}
            {activeAnalyst === "a_profile" && <AnalystProfile user={user} />}
          </main>
        </div>
      </div>
    );
  }

  // ================= ADMIN =================
  return (
    <div className="flex h-screen w-full bg-zinc-50 text-zinc-900">
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-olive-700 text-white">
        <div className="px-4 py-4 flex items-center gap-3 border-b border-white/10">
          <div className="h-9 w-9 rounded-xl bg-white text-olive-700 grid place-items-center font-bold shadow-sm">EB</div>
          <div>
            <div className="text-sm font-semibold tracking-wide">EBRS Insights</div>
            <div className="text-xs text-white/80">Admin Console</div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
          <SideLink icon={<Grid2X2 size={18} />} label="Overview" active={active === "overview"} onClick={() => setActive("overview")} />
          <SideLink icon={<Activity size={18} />} label="Completion" active={active === "completion"} onClick={() => setActive("completion")} />
          <SideLink icon={<LineChart size={18} />} label="Predictive Insights" active={active === "predictive"} onClick={() => setActive("predictive")} />
          <SideLink icon={<Users size={18} />} label="Field Management" active={active === "field"} onClick={() => setActive("field")} />
          <SideLink icon={<History size={18} />} label="Audit Trail" active={active === "audit"} onClick={() => setActive("audit")} />
          <div className="pt-2">
            <div className="px-3 text-[10px] uppercase tracking-wider text-white/70">System</div>
            <SideLink icon={<Settings size={18} />} label="Settings" />
            <SideLink icon={<UserCircle size={18} />} label="Profile" active={active === "profile"} onClick={() => setActive("profile")} />
          </div>
        </nav>

        <div className="px-3 py-4 border-t border-white/10">
          <div className="text-xs mb-1 text-white/80">Logged in as</div>
          <div className="text-sm font-medium">{user.name}</div>
        </div>
      </aside>

      <div className="flex-1 flex min-w-0 flex-col">
        <header className="h-14 border-b border-zinc-200 bg-white/70 backdrop-blur px-4 flex items-center justify-between">
          <Breadcrumb active={active} />
          <div className="flex items-center gap-2">
            <button className="btn-ghost"><Bell size={18} /></button>
            <button className="btn-ghost"><Download size={16} /> Export</button>
            <button className="btn-ghost text-rose-600" onClick={handleLogout}><LogOut size={16} /> Logout</button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {active === "overview" && (
            <div>
              <h2 className="text-xl font-semibold mb-4">Dataset Analytics</h2>
              <DatasetSelector onSelectDataset={setSelectedDataset} />
              <div className="my-4 flex gap-4">
                <label>
                  Region:
                  <input type="text" value={filters.region} onChange={(e) => setFilters({ ...filters, region: e.target.value })} className="ml-2 px-2 py-1 border rounded" />
                </label>
                <label>
                  Completed:
                  <select
                    value={filters.isComplete === undefined ? "" : String(!!filters.isComplete)}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        isComplete: e.target.value === "" ? undefined : e.target.value === "true",
                      })
                    }
                    className="ml-2 px-2 py-1 border rounded"
                  >
                    <option value="">All</option>
                    <option value="true">Completed</option>
                    <option value="false">Not Completed</option>
                  </select>
                </label>
              </div>
              <DatasetAnalytics datasetId={selectedDataset} filters={filters} />
              <Overview selectedDataset={selectedDataset} />
            </div>
          )}
          {active === "completion" && <Completion />}
          {active === "predictive" && <Predictive />}
          {active === "field" && <FieldMgmt />}
          {active === "audit" && <AuditTrail />}
          {active === "profile" && <AdminProfile user={user} />}
        </main>
      </div>
    </div>
  );
}

function SideLink({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={[
        "w-full text-left px-3 py-2 rounded-xl text-sm text-white/90 hover:bg-white/10",
        active ? "bg-white/15 text-white font-semibold" : "",
      ].join(" ")}
    >
      <span className="mr-3 inline-grid place-items-center">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function labelForField(key) {
  switch (key) {
    case "home": return "Dashboard";
    case "surveys": return "My Surveys";
    case "assignments": return "Assignments";
    case "uploads": return "Uploads";
    case "announcements": return "Announcements";
    case "profile": return "Profile";
    default: return "Dashboard";
  }
}

function labelForAnalyst(key) {
  switch (key) {
    case "a_home": return "Dashboard";
    case "a_reports": return "Reports";
    case "a_generate": return "Generate Reports";
    case "a_data": return "Data Explorer";
    case "a_profile": return "Profile";
    default: return "Dashboard";
  }
}
