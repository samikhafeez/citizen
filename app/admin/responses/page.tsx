"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SURVEY } from "@/lib/survey-data";

interface AnswerRow {
  questionId: string;
  value?: string | string[];
  freeText?: string;
  relevance?: string;
  skipped?: boolean;
  scrubbed?: boolean;
  isRelevant?: boolean;
  qualityFlag?: string;
  lengthBand?: string;
}
interface Row {
  id: string;
  language: string;
  status: string;
  startedAt: string;
  answers: AnswerRow[];
}

function qLabel(id: string) {
  return SURVEY.questions.find((q) => q.id === id)?.prompt.en ?? id;
}

export default function Responses() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [role, setRole] = useState<"admin" | "viewer">("viewer");
  const [onlyFreeText, setOnlyFreeText] = useState(true);

  function load() {
    fetch("/api/admin?view=responses")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        setRows(d.rows);
        setRole(d.role || "viewer");
      })
      .catch((s) => s === 401 && router.push("/admin/login"));
  }
  useEffect(load, [router]);

  async function del(id: string) {
    if (!confirm("Delete this session permanently? (data-subject erasure)")) return;
    await fetch(`/api/admin?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  }

  if (!rows) return <p className="small">Loading…</p>;

  // Flatten free-text answers for the qualitative explorer.
  const freeTexts = rows.flatMap((r) =>
    r.answers
      .filter((a) => a.freeText)
      .map((a) => ({
        sid: r.id,
        lang: r.language,
        qid: a.questionId,
        text: a.freeText!,
        rel: a.relevance,
        scrubbed: a.scrubbed,
        quality: a.qualityFlag,
        band: a.lengthBand,
      }))
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <label className="small">
          <input type="checkbox" checked={onlyFreeText} onChange={(e) => setOnlyFreeText(e.target.checked)} />{" "}
          Free-text explorer only
        </label>
        <span style={{ flex: 1 }} />
        {role === "admin" && (
          <a className="btn btn-secondary" style={{ width: "auto" }} href="/api/admin?view=export">
            ⬇ Export CSV
          </a>
        )}
      </div>

      {onlyFreeText ? (
        <table className="data">
          <thead>
            <tr>
              <th>Question</th>
              <th>Lang</th>
              <th>Free-text answer</th>
              <th>Relevance</th>
              <th>Quality</th>
              <th>Length</th>
              <th>PII</th>
            </tr>
          </thead>
          <tbody>
            {freeTexts.length === 0 && (
              <tr><td colSpan={7} className="small">No free-text answers yet.</td></tr>
            )}
            {freeTexts.map((f, i) => (
              <tr key={i}>
                <td>{qLabel(f.qid)}</td>
                <td>{f.lang}</td>
                <td>{f.text}</td>
                <td>
                  <span className={`tag ${f.rel === "off_topic" ? "offtopic" : f.rel === "sensitive" ? "sensitive" : ""}`}>
                    {f.rel || "—"}
                  </span>
                </td>
                <td>
                  <span className={`tag ${f.quality && f.quality !== "ok" ? "offtopic" : ""}`}>{f.quality || "—"}</span>
                </td>
                <td className="small">{f.band || "—"}</td>
                <td className="small">{f.scrubbed ? "✓ scrubbed" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Session</th>
              <th>Lang</th>
              <th>Status</th>
              <th>Answers</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td title={r.id}>{r.id.slice(0, 8)}…</td>
                <td>{r.language}</td>
                <td>{r.status}</td>
                <td>{r.answers.filter((a) => !a.skipped).length}</td>
                <td>
                  {role === "admin" ? (
                    <button className="btn btn-ghost" style={{ width: "auto", color: "#a23" }} onClick={() => del(r.id)}>
                      Delete
                    </button>
                  ) : (
                    <span className="small">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="small" style={{ marginTop: 12 }}>
        Free-text is PII-scrubbed before storage (emails, phone numbers and URLs replaced) and
        again here at display, as defence-in-depth. This is a simple regex pass, not full name
        detection — stronger scrubbing is available in the Phase 2 analysis pipeline.
      </p>
    </div>
  );
}
