"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SURVEY } from "@/lib/survey-data";

interface Metrics {
  total: number;
  totalUnfiltered: number;
  completed: number;
  stopped: number;
  completionRate: number;
  byLang: Record<string, number>;
  freeTextCount: number;
  answeredCount: number;
  dropoff: Record<string, number>;
  distributions: Record<string, Record<string, number>>;
  volumeByDay: Record<string, number>;
  themeStats: Record<string, { answered: number; freeText: number }>;
  insights: string[];
  themeSummary: { theme: string; title: string; answers: number; insight: string }[];
  freeTextPreview: {
    excerpt: string;
    theme: string;
    question: string;
    relevance: string;
    qualityFlag: string;
    lengthBand: string;
    scrubbed: boolean;
  }[];
  previewSuppressed: boolean;
  freeTextQuality: {
    relevance: Record<string, number>;
    quality: Record<string, number>;
    scrubbed: number;
    total: number;
    relevant: number;
    unclearOffTopic: number;
    tooShort: number;
    ok: number;
  };
  filters: Record<string, string>;
  surveyVersion: string;
  role: "admin" | "viewer";
}

type FilterState = { lang: string; age: string; gender: string; area: string };
const EMPTY: FilterState = { lang: "", age: "", gender: "", area: "" };

function qLabel(id: string): string {
  return SURVEY.questions.find((q) => q.id === id)?.prompt.en ?? id;
}
function optLabel(qid: string, value: string): string {
  const q = SURVEY.questions.find((x) => x.id === qid);
  return q?.options?.find((o) => o.value === value)?.label.en ?? value;
}
function optionsFor(qid: string) {
  return SURVEY.questions.find((q) => q.id === qid)?.options ?? [];
}
const themeTitle = (id: string) =>
  SURVEY.themes.find((t) => t.id === id)?.title.en ?? id;

type Seg = { label: string; value: number; color: string };
const PALETTE = ["#2e6ca4", "#8bb3d6", "#1f3a5f", "#c9d6e3", "#5b6b7b"];

function Donut({ data, size = 104 }: { data: Seg[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="chart">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef2f6" strokeWidth="12" />
      {total > 0 &&
        data.map((d, i) => {
          const dash = (d.value / total) * C;
          const el = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth="12"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-off}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
          off += dash;
          return el;
        })}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize="20" fontWeight={700} fill="#1f3a5f">
        {total}
      </text>
    </svg>
  );
}
function Legend({ data }: { data: Seg[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
      {data.map((d) => (
        <span key={d.label} className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <i style={{ width: 10, height: 10, borderRadius: 2, background: d.color, display: "inline-block" }} />
          {d.label}: {d.value}
        </span>
      ))}
    </div>
  );
}

function Bars({ data, labelFor }: { data: Record<string, number>; labelFor: (k: string) => string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (entries.length === 0) return <p className="small">No data yet.</p>;
  return (
    <div className="barchart">
      {entries.map(([k, v]) => (
        <div className="bar-row" key={k}>
          <span title={labelFor(k)} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {labelFor(k)}
          </span>
          <span className="bar" style={{ width: `${(v / max) * 100}%` }} />
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [m, setM] = useState<Metrics | null>(null);
  const [err, setErr] = useState("");
  const [filters, setFilters] = useState<FilterState>(EMPTY);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    return p.toString();
  }, [filters]);

  const load = useCallback(() => {
    fetch(`/api/admin?view=metrics${qs ? "&" + qs : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setM)
      .catch((s) => (s === 401 ? router.push("/admin/login") : setErr("Failed to load.")));
  }, [qs, router]);

  useEffect(() => load(), [load]);

  async function logout() {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.push("/admin/login");
  }

  if (err) return <p>{err}</p>;
  if (!m) return <p className="small">Loading…</p>;

  const themed = SURVEY.questions.filter((q) => q.type !== "freetext");
  const filtersActive = Object.values(filters).some(Boolean);
  const exportHref = `/api/admin?view=export${qs ? "&" + qs : ""}`;

  const Select = ({ label, field, qid }: { label: string; field: keyof FilterState; qid: string }) => (
    <label className="small" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {label}
      <select
        className="field"
        style={{ padding: "6px 8px", minWidth: 120 }}
        value={filters[field]}
        onChange={(e) => setFilters({ ...filters, [field]: e.target.value })}
      >
        <option value="">All</option>
        {optionsFor(qid).map((o) => (
          <option key={o.value} value={o.value}>{o.label.en}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span className="small">Survey {m.surveyVersion} · role: {m.role}</span>
        <span style={{ flex: 1 }} />
        {m.role === "admin" && (
          <a className="btn btn-secondary" style={{ width: "auto" }} href={exportHref}>
            ⬇ Export CSV{filtersActive ? " (filtered)" : ""}
          </a>
        )}
        <button className="btn btn-ghost" style={{ width: "auto" }} onClick={logout}>
          Sign out
        </button>
      </div>

      {/* Filters (Section 4.4 / 4.8) */}
      <div className="card" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="small" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          Language
          <select
            className="field"
            style={{ padding: "6px 8px", minWidth: 120 }}
            value={filters.lang}
            onChange={(e) => setFilters({ ...filters, lang: e.target.value })}
          >
            <option value="">All</option>
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </select>
        </label>
        <Select label="Age band" field="age" qid="age_band" />
        <Select label="Gender" field="gender" qid="gender" />
        <Select label="Area" field="area" qid="area" />
        {filtersActive && (
          <button className="btn btn-ghost" style={{ width: "auto" }} onClick={() => setFilters(EMPTY)}>
            Clear filters
          </button>
        )}
        <span className="small" style={{ marginInlineStart: "auto" }}>
          Showing {m.total} of {m.totalUnfiltered} session(s)
        </span>
      </div>

      <div className="metrics">
        <div className="metric"><div className="n">{m.total}</div><div className="l">Responses (filtered)</div></div>
        <div className="metric"><div className="n">{m.completed}</div><div className="l">Completed</div></div>
        <div className="metric"><div className="n">{m.completionRate}%</div><div className="l">Completion rate</div></div>
        <div className="metric"><div className="n">{m.stopped}</div><div className="l">Stopped early</div></div>
        <div className="metric"><div className="n">{m.freeTextCount}</div><div className="l">Free-text answers</div></div>
        <div className="metric"><div className="n">{m.byLang.ar || 0} / {m.byLang.en || 0}</div><div className="l">Arabic / English</div></div>
      </div>

      {/* Key insights + at-a-glance donuts */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginTop: 16 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <h3 style={{ marginTop: 0 }}>Key insights</h3>
          <ul style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.6 }}>
            {m.insights.map((s, i) => (
              <li key={i} className="small" style={{ marginBottom: 4 }}>{s}</li>
            ))}
          </ul>
        </div>
        <div className="card" style={{ marginBottom: 0, textAlign: "center" }}>
          <h3 style={{ marginTop: 0 }}>Language</h3>
          {(() => {
            const segs: Seg[] = [
              { label: "Arabic", value: m.byLang.ar || 0, color: PALETTE[0] },
              { label: "English", value: m.byLang.en || 0, color: PALETTE[1] },
            ];
            return (<><Donut data={segs} /><Legend data={segs} /></>);
          })()}
        </div>
        <div className="card" style={{ marginBottom: 0, textAlign: "center" }}>
          <h3 style={{ marginTop: 0 }}>Completion</h3>
          {(() => {
            const inProgress = Math.max(0, m.total - m.completed - m.stopped);
            const segs: Seg[] = [
              { label: "Completed", value: m.completed, color: PALETTE[2] },
              { label: "Stopped", value: m.stopped, color: PALETTE[4] },
              { label: "In progress", value: inProgress, color: PALETTE[3] },
            ];
            return (<><Donut data={segs} /><Legend data={segs} /></>);
          })()}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Response volume (sessions started per day)</h3>
        <Bars data={m.volumeByDay} labelFor={(d) => d} />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Drop-off (last question before leaving)</h3>
        <Bars data={m.dropoff} labelFor={qLabel} />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>By theme (answers given)</h3>
        <Bars
          data={Object.fromEntries(Object.entries(m.themeStats).map(([t, v]) => [t, v.answered]))}
          labelFor={themeTitle}
        />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Free-text quality</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {[
            { l: "Total", v: m.freeTextQuality.total },
            { l: "Relevant", v: m.freeTextQuality.relevant },
            { l: "Unclear/off-topic", v: m.freeTextQuality.unclearOffTopic },
            { l: "Too short", v: m.freeTextQuality.tooShort },
            { l: "OK quality", v: m.freeTextQuality.ok },
            { l: "PII scrubbed", v: m.freeTextQuality.scrubbed },
          ].map((s) => (
            <div key={s.l} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", minWidth: 90 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--navy)" }}>{s.v}</div>
              <div className="small">{s.l}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <strong className="small">Relevance breakdown</strong>
            <Bars data={m.freeTextQuality.relevance} labelFor={(k) => k} />
          </div>
          <div>
            <strong className="small">Quality flags</strong>
            <Bars data={m.freeTextQuality.quality} labelFor={(k) => k} />
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Theme summary</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          {m.themeSummary.map((ts) => (
            <div key={ts.theme} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <strong>{ts.title}</strong>
                <span className="small">{ts.answers} answer(s)</span>
              </div>
              <p className="small" style={{ margin: "6px 0 0" }}>{ts.insight}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Free-text response preview</h3>
        {m.previewSuppressed ? (
          <p className="small">
            Hidden until at least 5 free-text responses are collected (small-sample privacy guard).
          </p>
        ) : m.freeTextPreview.length === 0 ? (
          <p className="small">No free-text answers yet.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Excerpt</th>
                <th>Theme / question</th>
                <th>Relevance</th>
                <th>Quality</th>
                <th>Length</th>
                <th>PII</th>
              </tr>
            </thead>
            <tbody>
              {m.freeTextPreview.map((f, i) => (
                <tr key={i}>
                  <td>{f.excerpt}</td>
                  <td className="small">{themeTitle(f.theme)} — {qLabel(f.question)}</td>
                  <td>
                    <span className={`tag ${f.relevance === "off_topic" ? "offtopic" : f.relevance === "sensitive" ? "sensitive" : ""}`}>
                      {f.relevance}
                    </span>
                  </td>
                  <td><span className={`tag ${f.qualityFlag !== "ok" ? "offtopic" : ""}`}>{f.qualityFlag}</span></td>
                  <td className="small">{f.lengthBand}</td>
                  <td className="small">{f.scrubbed ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small" style={{ marginTop: 8 }}>Scrubbed excerpts only — no raw personal details are shown.</p>
      </div>

      <h3>Answer distributions (per question)</h3>
      {themed.map((q) => (
        <div className="card" key={q.id}>
          <strong>{q.prompt.en}</strong>
          <div style={{ marginTop: 8 }}>
            <Bars data={m.distributions[q.id] || {}} labelFor={(v) => optLabel(q.id, v)} />
          </div>
        </div>
      ))}

      <p className="small" style={{ marginTop: 16, padding: 10, background: "#fbeede", borderRadius: 8 }}>
        ⚠ Limitations: this is a small, self-selected pilot sample. Figures are indicative only and
        not representative of the wider population. Filtering reduces the sample further — interpret
        small filtered counts with particular care.
      </p>
    </div>
  );
}
