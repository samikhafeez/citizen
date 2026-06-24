"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Hit {
  responseRef: string;
  questionId: string;
  theme: string;
  language: string;
  text: string;
  score: number;
  createdAt?: string;
}
interface Result {
  summary: string;
  sources: Hit[];
  totalFreeText: number;
}

const SUGGESTIONS = [
  "What challenges do people face with digital water tools?",
  "How could technology improve water management?",
  "Does reporting water issues lead to improvement?",
  "هل التبليغ يؤدي إلى تحسن؟",
];

export default function RagPanel() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  async function run(query?: string) {
    const text = (query ?? q).trim();
    if (!text) return;
    setBusy(true);
    setErr("");
    setRes(null);
    const r = await fetch(`/api/admin?view=rag&q=${encodeURIComponent(text)}&k=8`);
    if (r.status === 401) return router.push("/admin/login");
    if (!r.ok) {
      setErr("Query failed.");
      setBusy(false);
      return;
    }
    setRes(await r.json());
    setBusy(false);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rag-sync" }),
      });
      if (r.status === 401) return router.push("/admin/login");
      const data = await r.json();
      if (!r.ok) {
        setSyncMsg(`Sync failed: ${data.error || "Server error"}`);
      } else {
        setSyncMsg("Sync completed successfully! Chunks and embeddings updated in Supabase.");
      }
    } catch {
      setSyncMsg("Sync failed: Network error.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <h2 className="title">RAG query (Phase 2 preview)</h2>
      <p className="small">
        Ask a question over the collected free-text answers. Results are{" "}
        <strong>extractive and cited</strong> — drawn directly from real answers, grouped by theme,
        with no generated claims. The full semantic pipeline (local embeddings + optional local LLM)
        lives in <code>analysis/</code>.
      </p>

      {/* Sync Embeddings UI Card */}
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <strong style={{ fontSize: 15, color: "var(--navy)" }}>Database Embeddings Sync</strong>
          <p className="small" style={{ margin: "4px 0 0" }}>
            Extracts new responses from Supabase, scrubs PII, computes local vector embeddings using the local e5 model, and uploads the results back to the database.
          </p>
        </div>
        <button className="btn btn-secondary" style={{ width: "auto", minWidth: 120 }} disabled={syncing} onClick={handleSync}>
          {syncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>
      {syncMsg && (
        <div className="card" style={{ 
          marginTop: -8, 
          marginBottom: 16, 
          padding: "8px 12px", 
          fontSize: 13, 
          background: syncMsg.includes("failed") ? "#fbebeb" : "#ebfbf0", 
          color: syncMsg.includes("failed") ? "#a23" : "#166534",
          borderColor: syncMsg.includes("failed") ? "#f5c2c2" : "#bbf7d0"
        }}>
          {syncMsg}
        </div>
      )}

      <div className="card">
        <textarea
          className="field"
          style={{ minHeight: 70 }}
          placeholder="e.g. What makes digital water tools hard to use?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary" style={{ width: "auto" }} disabled={busy} onClick={() => run()}>
            {busy ? "Searching…" : "Run query"}
          </button>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="btn btn-secondary" style={{ width: "auto", fontSize: 12 }} onClick={() => { setQ(s); run(s); }}>
              {s.length > 38 ? s.slice(0, 36) + "…" : s}
            </button>
          ))}
        </div>
      </div>

      {err && <p style={{ color: "#a23" }}>{err}</p>}

      {res && (
        <>
          <div className="card">
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>{res.summary}</pre>
          </div>
          <h3>Sources ({res.sources.length})</h3>
          {res.sources.length === 0 ? (
            <p className="small">No matching answers. Collect more responses, or try different words.</p>
          ) : (
            <table className="data">
              <thead>
                <tr><th>Ref</th><th>Theme</th><th>Lang</th><th>Submitted At</th><th>Answer</th><th>Score</th></tr>
              </thead>
              <tbody>
                {res.sources.map((h) => (
                  <tr key={h.responseRef + h.text}>
                    <td><span className="tag">{h.responseRef}</span></td>
                    <td>{h.theme}</td>
                    <td>{h.language}</td>
                    <td>{h.createdAt ? h.createdAt.slice(0, 16).replace("T", " ") : "—"}</td>
                    <td>{h.text}</td>
                    <td>{h.score.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small" style={{ marginTop: 10, padding: 10, background: "#fbeede", borderRadius: 8 }}>
            ⚠ A summary is evidence only if it cites its sources. This preview uses lexical (keyword)
            retrieval over {res.totalFreeText} free-text answer(s); use the <code>analysis/</code>{" "}
            pipeline with local embeddings for semantic search and richer summaries.
          </p>
        </>
      )}
    </div>
  );
}
