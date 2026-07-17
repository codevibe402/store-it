"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function SharePasswordGate({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/shared/${token}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Incorrect password");
      return;
    }
    // The server just set a session cookie scoped to this token — re-run
    // the page's server-side fetch, which will now forward that cookie
    // and succeed without needing the password again.
    router.refresh();
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: #0d0f14; color: #e8eaf0; min-height: 100vh;
          display: flex; align-items: center; justify-content: center; padding: 24px;
        }
        .gate {
          max-width: 360px; width: 100%; background: #13161e; border: 1px solid #252a38;
          border-radius: 14px; padding: 28px;
        }
        .gate h1 { font-size: 1.1rem; font-weight: 700; margin-bottom: 6px; }
        .gate p { font-size: 0.82rem; color: #6b7280; margin-bottom: 18px; }
        .gate input {
          width: 100%; background: #1a1e28; border: 1px solid #252a38; color: #e8eaf0;
          border-radius: 8px; padding: 10px 12px; font-size: 0.88rem; outline: none; margin-bottom: 10px;
        }
        .gate input:focus { border-color: #6c8eff88; }
        .gate button {
          width: 100%; background: #6c8eff; color: #0d0f14; border: none; border-radius: 8px;
          padding: 10px 12px; font-size: 0.88rem; font-weight: 600; cursor: pointer;
        }
        .gate button:disabled { opacity: 0.5; cursor: default; }
        .gate .err { color: #f87171; font-size: 0.78rem; margin-top: 8px; }
      `}</style>
      <div className="gate">
        <h1>🔒 Password required</h1>
        <p>This shared folder is password-protected.</p>
        <form onSubmit={submit}>
          <input
            autoFocus
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" disabled={busy || !password}>{busy ? "Checking…" : "Unlock"}</button>
        </form>
        {error && <div className="err">{error}</div>}
      </div>
    </>
  );
}
