"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function AdminLogin() {
  return (
    <Suspense fallback={null}>
      <AdminLoginInner />
    </Suspense>
  );
}

function AdminLoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", email, password }),
    });
    if (res.ok) {
      router.push(params.get("next") || "/admin");
    } else {
      setError("Incorrect credentials.");
      setBusy(false);
    }
  }

  return (
    <div className="admin-wrap" dir="ltr" style={{ maxWidth: 400 }}>
      <h2 className="title">Researcher sign in</h2>
      <p className="small">Authorised researchers only. Access is logged.</p>
      <form onSubmit={login} className="card" style={{ marginTop: 12 }}>
        <label className="small" htmlFor="email">Email <span style={{ color: "#999" }}>(Supabase mode)</span></label>
        <input
          id="email"
          className="field"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="researcher@university.ac.uk"
          style={{ margin: "6px 0 12px" }}
          autoComplete="username"
        />
        <label className="small" htmlFor="pw">Password</label>
        <input
          id="pw"
          className="field"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ margin: "6px 0 12px" }}
          autoComplete="current-password"
          autoFocus
        />
        {error && <p style={{ color: "#a23", fontSize: 13 }}>{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="small" style={{ marginTop: 10 }}>
          <strong>Dev mode</strong> (no Supabase): leave email blank, password{" "}
          <code>admin</code> (set <code>ADMIN_PASSWORD</code> in <code>.env.local</code>).{" "}
          <strong>Supabase mode</strong>: sign in with your researcher email; role
          (admin/viewer) comes from the <code>admins</code> table.
        </p>
      </form>
    </div>
  );
}
