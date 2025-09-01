import { useState } from "react";
import {
  Bell, Download, Moon, Sun,
  Grid2X2, Activity, LineChart, Users, History, Settings
} from "lucide-react";

import Overview from "./pages/Overview.jsx";
import Completion from "./pages/Completion.jsx";
import Predictive from "./pages/Predictive.jsx";
import FieldMgmt from "./pages/FieldMgmt.jsx";
import AuditTrail from "./pages/AuditTrail.jsx";
import { Breadcrumb } from "./components/ui";
import clsx from "clsx";

export default function App() {
  const [dark, setDark] = useState(false);
  const [active, setActive] = useState("overview");

  return (
    <div className={dark ? "dark" : ""}>
      <div className="flex h-screen w-full bg-zinc-50 text-zinc-900">
        {/* Sidebar */}
        <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-olive-700 text-white">
          <div className="px-4 py-4 flex items-center gap-3 border-b border-white/10">
            <div className="h-9 w-9 rounded-xl bg-white text-olive-700 grid place-items-center font-bold shadow-sm">EB</div>
            <div>
              <div className="text-sm font-semibold tracking-wide">EBRS Insights</div>
              <div className="text-xs text-white/80">Admin Console</div>
            </div>
          </div>

          <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
            <SideLink icon={<Grid2X2 size={18} />} label="Overview"            active={active==="overview"}  onClick={()=>setActive("overview")} />
            <SideLink icon={<Activity size={18} />} label="Completion"          active={active==="completion"} onClick={()=>setActive("completion")} />
            <SideLink icon={<LineChart size={18} />} label="Predictive Insights" active={active==="predictive"} onClick={()=>setActive("predictive")} />
            <SideLink icon={<Users size={18} />} label="Field Management"       active={active==="field"}     onClick={()=>setActive("field")} />
            <SideLink icon={<History size={18} />} label="Audit Trail"          active={active==="audit"}     onClick={()=>setActive("audit")} />
            <div className="pt-2">
              <div className="px-3 text-[10px] uppercase tracking-wider text-white/70">System</div>
              <SideLink icon={<Settings size={18} />} label="Settings" />
            </div>
          </nav>

          <div className="px-3 py-4 border-t border-white/10">
            <div className="text-xs mb-1 text-white/80">Logged in as</div>
            <div className="text-sm font-medium">Hello, Admin</div>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 flex min-w-0 flex-col">
          {/* Header */}
          <header className="h-14 border-b border-zinc-200 bg-white/70 backdrop-blur px-4 flex items-center justify-between">
            <Breadcrumb active={active} />
            <div className="flex items-center gap-2">
              <button className="btn-ghost"><Bell size={18} /></button>
              <button className="btn-ghost" onClick={()=>setDark(v=>!v)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>
              <button className="btn-ghost"><Download size={16}/> Export</button>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            {active === "overview"   && <Overview   />}
            {active === "completion" && <Completion />}
            {active === "predictive" && <Predictive />}
            {active === "field"      && <FieldMgmt  />}
            {active === "audit"      && <AuditTrail />}
          </main>
        </div>
      </div>
    </div>
  );
}

function SideLink({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full text-left px-3 py-2 rounded-xl text-sm text-white/90 hover:bg-white/10",
        active && "bg-white/15 text-white font-semibold"
      )}
    >
      <span className="mr-3 inline-grid place-items-center">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
