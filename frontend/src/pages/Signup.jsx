// src/pages/Signup.jsx
import { Shield, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { useState } from "react";

export default function Signup({ role, onBackToLogin, onBackToRoleSelection }) {
  const roleTitle = role === "admin" ? "Admin" : role === "field" ? "Field Researcher" : "Analyst";
  const roleSubtitle =
    role === "admin" ? "Admin Console" : role === "field" ? "Field Researcher Portal" : "Analyst Workspace";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [accepted, setAccepted] = useState(false);

  // Real-time mismatch flag
  const passwordsMismatch = pw2.length > 0 && pw !== pw2;

  function handleSignupSubmit(e) {
    e.preventDefault();
    if (!name || !email || !pw || !pw2 || passwordsMismatch || !accepted) return;

    // Simulate account creation (no auto-login)
    localStorage.setItem("auth_flash", "Account created successfully. Please sign in to continue.");
    localStorage.setItem("signup_email", email);

    onBackToLogin?.();
  }

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
            <div className="text-xs text-white/80">{roleSubtitle}</div>
          </div>
        </div>

        <div>
          <h1 className="text-3xl font-semibold">{roleTitle} Signup</h1>
          <p className="text-white/80 mt-2">
            {role === "admin" && "Create an admin account to access the console"}
            {role === "field" && "Create your field researcher account"}
            {role === "analyst" && "Create your analyst account to access insights"}
          </p>
        </div>

        <div className="text-xs text-white/60">&copy; {new Date().getFullYear()} EBRS</div>
      </div>

      {/* Right: form card */}
      <div className="flex flex-1 items-center justify-center bg-zinc-50 p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center md:hidden">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-olive-700 text-white">
              <Shield size={22} />
            </div>
            <div className="text-lg font-semibold">EBRS Insights</div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-zinc-900">{roleTitle} Signup</h2>
            <p className="mt-1 text-sm text-zinc-600">Create your {roleTitle.toLowerCase()} account</p>

            <form onSubmit={handleSignupSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm mb-1">Full name</label>
                <input
                  type="text"
                  className="w-full rounded-xl border px-3 py-2 text-sm border-zinc-300 focus:border-olive-500"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

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
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700"
                    aria-label="Toggle password visibility"
                  >
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm mb-1">Confirm password</label>
                <div className="relative">
                  <input
                    type={showPw2 ? "text" : "password"}
                    className={`w-full rounded-xl border px-3 py-2 text-sm pr-10 ${
                      passwordsMismatch ? "border-rose-400 focus:border-rose-500" : "border-zinc-300 focus:border-olive-500"
                    }`}
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw2((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700"
                    aria-label="Toggle confirm password visibility"
                  >
                    {showPw2 ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                {/* Password mismatch note */}
                {passwordsMismatch && (
                  <p className="mt-1 text-xs text-rose-600">Passwords do not match</p>
                )}
              </div>

              <label className="flex items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-300 text-olive-700"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  required
                />
                <span>I agree to the Terms and acknowledge the Privacy Policy.</span>
              </label>

              <button
                type="submit"
                className="w-full rounded-xl bg-olive-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-olive-800 disabled:opacity-50"
                disabled={!name || !email || !pw || !pw2 || passwordsMismatch || !accepted}
              >
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 size={16} /> Create account
                </span>
              </button>

              <div className="flex items-center justify-between">
                <button type="button" onClick={onBackToLogin} className="mt-2 text-xs text-zinc-500 hover:underline">
                  ← Back to login
                </button>
                <button type="button" onClick={onBackToRoleSelection} className="mt-2 text-xs text-zinc-500 hover:underline">
                  ← Role selection
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
