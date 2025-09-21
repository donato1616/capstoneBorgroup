// src/pages/Login.jsx
import { Shield, User, Users, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export default function Login({ onLogin }) {
  const [role, setRole] = useState(null); // "admin" | "field" | null
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (email && pw) {
      const userObj = { name: role === "admin" ? "Admin" : "Field Researcher", email, role };
      const token = `${role}-demo-token`;
      localStorage.setItem("auth_user", JSON.stringify(userObj));
      localStorage.setItem("auth_token", token);
      onLogin(userObj);
    }
  }

  // STEP 1: Role selection
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
            <button
              onClick={() => setRole("admin")}
              className="flex items-center justify-center gap-2 rounded-xl bg-olive-700 px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-olive-800"
            >
              <User size={18} /> Admin Login
            </button>
            <button
              onClick={() => setRole("field")}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50"
            >
              <Users size={18} /> Field Researcher Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // STEP 2: Role-specific login form
  return (
    <div className="flex h-screen w-full">
      {/* Left: brand panel */}
      <div className="hidden md:flex flex-col justify-between w-1/2 bg-olive-700 text-white p-10">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-white text-olive-700 grid place-items-center font-bold shadow-sm">
            EB
          </div>
          <div>
            <div className="text-lg font-semibold">EBRS Insights</div>
            <div className="text-xs text-white/80">
              {role === "admin" ? "Admin Console" : "Field Researcher Portal"}
            </div>
          </div>
        </div>
        <div>
          <h1 className="text-3xl font-semibold">
            {role === "admin" ? "Admin Login" : "Field Researcher Login"}
          </h1>
          <p className="text-white/80 mt-2">
            {role === "admin"
              ? "Sign in to manage the dashboard"
              : "Sign in to submit and track surveys"}
          </p>
        </div>
        <div className="text-xs text-white/60">
          &copy; {new Date().getFullYear()} EBRS
        </div>
      </div>

      {/* Right: login form */}
      <div className="flex flex-1 items-center justify-center bg-zinc-50 p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center md:hidden">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-olive-700 text-white">
              <Shield size={22} />
            </div>
            <div className="text-lg font-semibold">EBRS Insights</div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-zinc-900">
              {role === "admin" ? "Admin Login" : "Field Researcher Login"}
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              Use your {role} credentials
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm mb-1">Email</label>
                <input
                  type="email"
                  className="w-full rounded-xl border px-3 py-2 text-sm border-zinc-300 focus:border-olive-500"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700"
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
                onClick={() => setRole(null)}
                className="w-full mt-2 text-xs text-zinc-500 hover:underline"
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
