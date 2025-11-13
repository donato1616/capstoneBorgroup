// src/pages/Login.jsx
import { Shield, User, Users, BarChart3, Eye, EyeOff, CheckCircle2, X } from "lucide-react";
import { useEffect, useState } from "react";

export default function Login({ onLogin }) {
  const [role, setRole] = useState(() => localStorage.getItem("auth_role") || null);
  const [mode, setMode] = useState(() => localStorage.getItem("auth_mode") || "login");

  useEffect(() => {
    if (role) localStorage.setItem("auth_role", role);
    else localStorage.removeItem("auth_role");
  }, [role]);

  useEffect(() => {
    localStorage.setItem("auth_mode", mode);
  }, [mode]);

  // Login form state
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [flash, setFlash] = useState(() => localStorage.getItem("auth_flash") || "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => {
      setFlash("");
      localStorage.removeItem("auth_flash");
    }, 5050);
    return () => clearTimeout(t);
  }, [flash]);

  function resetAuthFields() {
    setName("");
    setPw("");
    setShowPw(false);
    setError("");
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    setError("");

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, name, password: pw }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");

      const userObj = data.user;
      localStorage.setItem("auth_user", JSON.stringify(userObj));
      localStorage.setItem("auth_token", data.token);
      localStorage.removeItem("auth_role");
      localStorage.removeItem("auth_mode");
      localStorage.removeItem("auth_flash");

      onLogin(userObj);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!role) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-zinc-50 p-6">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-olive-700 text-white">
              <Shield size={22} />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-zinc-900 mb-2">Select Role</h2>
          <p className="text-sm text-zinc-600 mb-6">Choose how you want to sign in</p>

          <div className="flex flex-col gap-4">
            <button onClick={() => { setRole("admin"); setMode("login"); resetAuthFields(); }}
              className="flex items-center justify-center gap-2 rounded-xl bg-olive-700 px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-olive-800">
              <User size={18} /> Admin Login
            </button>
            <button onClick={() => { setRole("analyst"); setMode("login"); resetAuthFields(); }}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50">
              <BarChart3 size={18} /> Analyst Login
            </button>
            <button onClick={() => { setRole("field"); setMode("login"); resetAuthFields(); }}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50">
              <Users size={18} /> Field Researcher Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  const roleTitle = role === "admin" ? "Admin" : role === "field" ? "Field Researcher" : "Analyst";
  const roleSubtitle =
    role === "admin" ? "Admin Console" : role === "field" ? "Field Researcher Portal" : "Analyst Workspace";

  return (
    <div className="flex h-screen w-full">
      <div className="hidden md:flex flex-col justify-between w-1/2 bg-olive-700 text-white p-10">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-white text-olive-700 grid place-items-center font-bold shadow-sm">EB</div>
          <div>
            <div className="text-lg font-semibold">EBRS Insights</div>
            <div className="text-xs text-white/80">{roleSubtitle}</div>
          </div>
        </div>

        <div>
          <h1 className="text-3xl font-semibold">{roleTitle} Login</h1>
          <p className="text-white/80 mt-2">
            {role === "admin" && "Sign in to manage the dashboard"}
            {role === "field" && "Sign in to submit and track surveys"}
            {role === "analyst" && "Sign in to view analytics and generate reports"}
          </p>
        </div>

        <div className="text-xs text-white/60">&copy; {new Date().getFullYear()} EBRS</div>
      </div>

      <div className="flex flex-1 items-center justify-center bg-zinc-50 p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center md:hidden">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-olive-700 text-white">
              <Shield size={22} />
            </div>
            <div className="text-lg font-semibold">EBRS Insights</div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-zinc-900">{roleTitle} Login</h2>
            <p className="mt-1 text-sm text-zinc-600">Use your {roleTitle.toLowerCase()} credentials</p>

            {flash && (
              <div className="mt-4 mb-2 flex items-start gap-2 rounded-xl border border-olive-200 bg-olive-50 px-3 py-2 text-sm text-olive-800">
                <CheckCircle2 className="mt-[2px]" size={16} />
                <div className="flex-1">{flash}</div>
                <button onClick={() => { setFlash(""); localStorage.removeItem("auth_flash"); }}
                  className="text-olive-700/70 hover:text-olive-900" aria-label="Dismiss">
                  <X size={16} />
                </button>
              </div>
            )}

            {error && (
              <div className="mt-4 mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {error}
              </div>
            )}

            <form onSubmit={handleLoginSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm mb-1">Name</label>
                <input
                  type="text"
                  className="w-full rounded-xl border px-3 py-2 text-sm border-zinc-300 focus:border-olive-500"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    className="w-full rounded-xl border px-3 py-2 text-sm border-zinc-300 focus:border-olive-500 pr-10"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700"
                    aria-label="Toggle password visibility"
                  >
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-olive-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-olive-800"
              >
                Sign in
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setRole(null);
                  localStorage.removeItem("auth_role");
                  localStorage.setItem("auth_mode", "login");
                  setFlash(""); localStorage.removeItem("auth_flash");
                }}
                className="mt-2 text-xs text-zinc-500 hover:underline"
              >
                ← Back to role selection
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}