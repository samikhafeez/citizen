import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SURVEY } from "@/lib/survey-data";
import { listSessions, deleteSession } from "@/lib/store";
import { ragQuery } from "@/lib/rag-lexical";
import { scrub } from "@/lib/scrub";
import { assessQuality, isRelevant } from "@/lib/quality";
import { ADMIN_COOKIE, expectedPassword, makeToken, verifyToken, type Role } from "@/lib/auth";
import { getAnonClient, getServiceClient, isSupabaseBackend } from "@/lib/supabase";
import { logAudit, logExport } from "@/lib/audit";
import type { SessionRecord } from "@/lib/types";
import { execFile } from "child_process";
import path from "path";
import fs from "fs";

// ── Dashboard filters (Section 4.4 / 4.8): language + demographic bands ──
interface Filters {
  lang?: string; // en | ar
  age?: string;  // age_band value
  gender?: string;
  area?: string;
}

function parseFilters(url: URL): Filters {
  const g = (k: string) => url.searchParams.get(k) || undefined;
  return { lang: g("lang"), age: g("age"), gender: g("gender"), area: g("area") };
}

function demoValue(s: SessionRecord, questionId: string): string | undefined {
  const a = s.answers.find((x) => x.questionId === questionId && !x.skipped);
  if (!a || a.value == null) return undefined;
  return Array.isArray(a.value) ? a.value.join("|") : String(a.value);
}

function applyFilters(sessions: SessionRecord[], f: Filters): SessionRecord[] {
  return sessions.filter((s) => {
    if (f.lang && s.language !== f.lang) return false;
    if (f.age && demoValue(s, "age_band") !== f.age) return false;
    if (f.gender && demoValue(s, "gender") !== f.gender) return false;
    if (f.area && demoValue(s, "area") !== f.area) return false;
    return true;
  });
}

function activeFilters(f: Filters): Record<string, string> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => !!v)) as Record<string, string>;
}

export const dynamic = "force-dynamic";

function auth(): { role: Role } | null {
  return verifyToken(cookies().get(ADMIN_COOKIE)?.value);
}

// ── Credential verification: Supabase Auth (prod) or ADMIN_PASSWORD (dev) ──
async function verifyCredentials(
  email: string,
  password: string
): Promise<{ ok: boolean; role: Role }> {
  const supabaseConfigured =
    isSupabaseBackend() &&
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseConfigured && email) {
    const { data, error } = await getAnonClient().auth.signInWithPassword({ email, password });
    if (error || !data.user) return { ok: false, role: "viewer" };
    // Role comes from the admins table (defaults to viewer if not listed).
    let role: Role = "viewer";
    try {
      const { data: admin } = await getServiceClient()
        .from("admins")
        .select("role")
        .eq("email", email)
        .maybeSingle();
      if (admin?.role === "admin") role = "admin";
    } catch {
      /* admins table optional; default viewer */
    }
    return { ok: true, role };
  }

  // Dev / no-Supabase fallback: single shared password, full admin role.
  if (password === expectedPassword()) return { ok: true, role: "admin" };
  return { ok: false, role: "viewer" };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  if (body.action === "login") {
    const actor = String(body.email || "password-auth");
    const { ok, role } = await verifyCredentials(String(body.email || ""), String(body.password || ""));
    if (!ok) {
      await logAudit("login_failed", undefined, actor);
      return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
    }
    await logAudit("login", `role=${role}`, actor);
    const res = NextResponse.json({ ok: true, role });
    res.cookies.set(ADMIN_COOKIE, makeToken(role), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return res;
  }

  if (body.action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  // All other POST actions require authorization
  const session = auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (body.action === "rag-sync") {
    const pythonBin = process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
    const pythonExe = path.join(process.cwd(), "analysis", ".venv", pythonBin);
    const scriptPath = path.join(process.cwd(), "analysis", "pipeline.py");

    if (fs.existsSync(pythonExe) && fs.existsSync(scriptPath)) {
      try {
        const logOutput = await new Promise<string>((resolve, reject) => {
          execFile(
            pythonExe,
            [scriptPath, "--db", "--db-load"],
            { cwd: path.join(process.cwd(), "analysis") },
            (error, stdout, stderr) => {
              if (error) {
                console.error("RAG sync subprocess error:", error, stderr);
                reject(new Error(stderr || error.message));
                return;
              }
              resolve(stdout);
            }
          );
        });
        await logAudit("rag_sync", "Rebuilt Supabase vector embeddings", `role:${session.role}`);
        return NextResponse.json({ ok: true, output: logOutput });
      } catch (e: any) {
        console.error("Error executing RAG sync:", e);
        return NextResponse.json({ error: "Failed to run sync script: " + e.message }, { status: 500 });
      }
    } else {
      return NextResponse.json({ error: "Python environment not configured." }, { status: 400 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function GET(req: Request) {
  const session = auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "metrics";
  const filters = parseFilters(url);
  const all = await listSessions();
  const sessions = applyFilters(all, filters);

  if (view === "metrics") {
    return NextResponse.json({
      ...buildMetrics(sessions),
      totalUnfiltered: all.length,
      filters: activeFilters(filters),
      role: session.role,
    });
  }

  if (view === "responses") {
    // Free-text is scrubbed again (defence-in-depth) and tagged with derived
    // quality indicators (computed at read time — no DB change).
    const rows = sessions.map((s) => ({
      id: s.id,
      language: s.language,
      status: s.status,
      startedAt: s.startedAt,
      answers: s.answers.map((a) => {
        if (!a.freeText) return a;
        const ft = scrub(a.freeText);
        const q = assessQuality(ft);
        return {
          ...a,
          freeText: ft,
          isRelevant: isRelevant(a.relevance),
          relevanceCategory: a.relevance ?? "unclear",
          qualityFlag: q.qualityFlag,
          lengthBand: q.lengthBand,
        };
      }),
    }));
    return NextResponse.json({ rows, role: session.role });
  }

  if (view === "rag") {
    const q = url.searchParams.get("q") || "";
    const k = Number(url.searchParams.get("k") || "6");
    if (!q.trim()) return NextResponse.json({ error: "Missing query" }, { status: 400 });
    await logAudit("rag_query", q.slice(0, 120), `role:${session.role}`);

    // If DATA_BACKEND is Supabase, use our Python semantic search pipeline via the python.exe bridge
    if (process.env.DATA_BACKEND === "supabase") {
      const pythonExe = path.join(process.cwd(), "analysis", ".venv", "Scripts", "python.exe");
      const scriptPath = path.join(process.cwd(), "analysis", "query.py");

      if (fs.existsSync(pythonExe) && fs.existsSync(scriptPath)) {
        try {
          const result = await new Promise<any>((resolve, reject) => {
            execFile(
              pythonExe,
              [scriptPath, q, "--db", "--json", "--k", String(k)],
              { cwd: path.join(process.cwd(), "analysis") },
              (error, stdout, stderr) => {
                if (error) {
                  console.error("RAG semantic query subprocess error:", error, stderr);
                  reject(error);
                  return;
                }
                try {
                  const parsed = JSON.parse(stdout);
                  resolve({
                    summary: parsed.summary,
                    sources: parsed.sources.map((h: any) => ({
                      responseRef: h.response_ref,
                      questionId: h.question_id,
                      theme: h.theme,
                      language: h.language,
                      text: h.text,
                      score: h.score,
                      createdAt: h.created_at
                    })),
                    totalFreeText: parsed.sources.length
                  });
                } catch (parseErr) {
                  console.error("RAG semantic query parse error:", parseErr, stdout);
                  reject(parseErr);
                }
              }
            );
          });
          return NextResponse.json(result);
        } catch (e) {
          console.error("Error executing semantic search bridge:", e);
          return NextResponse.json({ error: "Semantic search query failed. Fallback to lexical." }, { status: 500 });
        }
      } else {
        console.warn("Python venv or query.py script not found. Falling back to local lexical search.");
      }
    }

    // Default local lexical search fallback
    const result = await ragQuery(q, isNaN(k) ? 6 : k);
    return NextResponse.json(result);
  }

  if (view === "export") {
    // Export contains the full dataset → admin role only.
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden (admin role required)" }, { status: 403 });
    }
    await logAudit("export", `sessions=${sessions.length}`, `role:${session.role}`);
    await logExport(activeFilters(filters), sessions.length);
    const csv = toCSV(sessions);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="responses_${SURVEY.version}.csv"`,
      },
    });
  }

  return NextResponse.json({ error: "Unknown view" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const session = auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden (admin role required)" }, { status: 403 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const ok = await deleteSession(id);
  await logAudit("delete", `session=${id}`, `role:${session.role}`);
  return NextResponse.json({ ok });
}

// ── deterministic presentation helpers (no LLM, scrubbed/aggregate only) ──
function optionLabelEn(qid: string, value: string): string {
  const q = SURVEY.questions.find((x) => x.id === qid);
  return q?.options?.find((o) => o.value === value)?.label.en ?? value;
}
function qPromptEn(qid: string): string {
  return SURVEY.questions.find((x) => x.id === qid)?.prompt.en ?? qid;
}
function themeTitleEn(id: string): string {
  return SURVEY.themes.find((t) => t.id === id)?.title.en ?? id;
}
function topOption(
  dist: Record<string, number> | undefined,
  exclude: string[] = []
): { value: string; count: number } | null {
  if (!dist) return null;
  const e = Object.entries(dist)
    .filter(([k]) => !exclude.includes(k))
    .sort((a, b) => b[1] - a[1]);
  return e.length && e[0][1] > 0 ? { value: e[0][0], count: e[0][1] } : null;
}
function scaleMean(dist: Record<string, number> | undefined): number | null {
  if (!dist) return null;
  let n = 0;
  let s = 0;
  for (const [k, v] of Object.entries(dist)) {
    const num = Number(k);
    if (!Number.isNaN(num)) {
      s += num * v;
      n += v;
    }
  }
  return n ? Math.round((s / n) * 10) / 10 : null;
}

interface InsightCtx {
  total: number;
  completionRate: number;
  dropoff: Record<string, number>;
  freeTextCount: number;
  relevant: number;
  unclearOffTopic: number;
  tooShort: number;
  scrubbed: number;
}
function buildInsights(dist: Record<string, Record<string, number>>, ctx: InsightCtx): string[] {
  const out: string[] = [];
  const tool = topOption(dist["acc_tools"], ["none", "other"]);
  if (tool) out.push(`Most-used digital tool: ${optionLabelEn("acc_tools", tool.value)} (${tool.count} mention${tool.count !== 1 ? "s" : ""}).`);
  const barrier = topOption(dist["chal_what"], ["none", "other"]);
  if (barrier) out.push(`Main reported barrier: ${optionLabelEn("chal_what", barrier.value)} (${barrier.count}).`);
  const trust = topOption(dist["trust_handled"]);
  if (trust) out.push(`Trust: the most common view on reports being handled responsibly is "${optionLabelEn("trust_handled", trust.value)}" (${trust.count}).`);
  const comfort = scaleMean(dist["trust_comfort"]);
  if (comfort != null) out.push(`Average comfort sharing information digitally: ${comfort}/5.`);
  if (ctx.total > 0) {
    const drop = topOption(ctx.dropoff);
    out.push(`Completion rate ${ctx.completionRate}%.${drop ? ` Most common drop-off point: ${qPromptEn(drop.value)} (${drop.count}).` : ""}`);
  }
  if (ctx.freeTextCount > 0)
    out.push(`Free-text: ${ctx.relevant} of ${ctx.freeTextCount} on-topic; ${ctx.tooShort} very short; ${ctx.unclearOffTopic} unclear/off-topic.`);
  out.push(`PII: ${ctx.scrubbed} free-text answer(s) had personal details scrubbed before storage.`);
  if (out.length === 0) out.push("No responses yet.");
  return out;
}
function buildThemeSummary(
  dist: Record<string, Record<string, number>>,
  themeStats: Record<string, { answered: number; freeText: number }>
): { theme: string; title: string; answers: number; insight: string }[] {
  const order = ["accessibility", "trust", "relevance", "challenges", "impact"];
  return order.map((th) => {
    const answers = themeStats[th]?.answered ?? 0;
    let insight = "No data yet.";
    if (answers > 0) {
      if (th === "accessibility") {
        const tool = topOption(dist["acc_tools"], ["none", "other"]);
        const ease = scaleMean(dist["acc_ease"]);
        insight = `${tool ? `Top tool: ${optionLabelEn("acc_tools", tool.value)}.` : ""}${ease != null ? ` Ease of access avg ${ease}/5.` : ""}`.trim() || "—";
      } else if (th === "trust") {
        const comfort = scaleMean(dist["trust_comfort"]);
        const handled = topOption(dist["trust_handled"]);
        insight = `${comfort != null ? `Comfort avg ${comfort}/5.` : ""}${handled ? ` Most: "${optionLabelEn("trust_handled", handled.value)}".` : ""}`.trim() || "—";
      } else if (th === "relevance") {
        const imp = topOption(dist["rel_improve"]);
        insight = imp ? `Most say tools could improve water management: "${optionLabelEn("rel_improve", imp.value)}".` : "—";
      } else if (th === "challenges") {
        const b = topOption(dist["chal_what"], ["none", "other"]);
        insight = b ? `Top barrier: ${optionLabelEn("chal_what", b.value)} (${b.count}).` : "—";
      } else if (th === "impact") {
        const r = topOption(dist["imp_result"]);
        const sat = scaleMean(dist["imp_satisfaction"]);
        insight = `${r ? `Most: "${optionLabelEn("imp_result", r.value)}".` : ""}${sat != null ? ` Satisfaction avg ${sat}/5.` : ""}`.trim() || "—";
      }
    }
    return { theme: th, title: themeTitleEn(th), answers, insight };
  });
}

// ── helpers ──
function buildMetrics(sessions: SessionRecord[]) {
  const total = sessions.length;
  const completed = sessions.filter((s) => s.status === "completed").length;
  const stopped = sessions.filter((s) => s.status === "stopped").length;
  const byLang = { en: 0, ar: 0 } as Record<string, number>;
  let freeTextCount = 0;
  let answeredCount = 0;
  const dropoff: Record<string, number> = {};
  const volumeByDay: Record<string, number> = {};
  // theme -> { answered, freeText }
  const themeOf: Record<string, string> = {};
  for (const q of SURVEY.questions) themeOf[q.id] = q.theme;
  const themeStats: Record<string, { answered: number; freeText: number }> = {};
  // Free-text quality summary (derived; no DB change).
  const relevanceBreakdown: Record<string, number> = {};
  const qualityBreakdown: Record<string, number> = {};
  let freeTextScrubbed = 0;
  const preview: {
    excerpt: string;
    theme: string;
    question: string;
    relevance: string;
    qualityFlag: string;
    lengthBand: string;
    scrubbed: boolean;
  }[] = [];

  for (const s of sessions) {
    byLang[s.language] = (byLang[s.language] || 0) + 1;
    const day = (s.startedAt || "").slice(0, 10);
    if (day) volumeByDay[day] = (volumeByDay[day] || 0) + 1;
    for (const a of s.answers) {
      if (!a.skipped) answeredCount++;
      if (a.freeText) {
        freeTextCount++;
        const rel = a.relevance ?? "unclear";
        relevanceBreakdown[rel] = (relevanceBreakdown[rel] || 0) + 1;
        if (a.scrubbed) freeTextScrubbed++;
        const ft = scrub(a.freeText); // scrubbed; never raw
        const q = assessQuality(ft);
        qualityBreakdown[q.qualityFlag] = (qualityBreakdown[q.qualityFlag] || 0) + 1;
        preview.push({
          excerpt: ft.length > 140 ? ft.slice(0, 140) + "…" : ft,
          theme: themeOf[a.questionId] || "other",
          question: a.questionId,
          relevance: rel,
          qualityFlag: q.qualityFlag,
          lengthBand: q.lengthBand,
          scrubbed: !!a.scrubbed,
        });
      }
      const theme = themeOf[a.questionId] || "other";
      const ts = (themeStats[theme] ??= { answered: 0, freeText: 0 });
      if (!a.skipped && a.value != null) ts.answered++;
      if (a.freeText) ts.freeText++;
    }
    if (s.status !== "completed" && s.answers.length > 0) {
      const last = s.answers[s.answers.length - 1].questionId;
      dropoff[last] = (dropoff[last] || 0) + 1;
    }
  }

  const distributions: Record<string, Record<string, number>> = {};
  for (const q of SURVEY.questions) {
    if (q.type === "freetext") continue;
    const dist: Record<string, number> = {};
    for (const s of sessions) {
      const a = s.answers.find((x) => x.questionId === q.id);
      if (!a || a.skipped || a.value == null) continue;
      const vals = Array.isArray(a.value) ? a.value : [a.value];
      for (const v of vals) dist[v] = (dist[v] || 0) + 1;
    }
    distributions[q.id] = dist;
  }

  // ── derived presentation aids (deterministic; scrubbed/aggregate only) ──
  const completionRate = total ? Math.round((completed / total) * 100) : 0;
  const relevantCount = (relevanceBreakdown.relevant || 0) + (relevanceBreakdown.partially_relevant || 0);
  const unclearOffTopic = (relevanceBreakdown.off_topic || 0) + (relevanceBreakdown.unclear || 0);
  const tooShortCount = qualityBreakdown.too_short || 0;
  const okCount = qualityBreakdown.ok || 0;

  // Small-sample guard: hide individual excerpts when there are very few responses.
  const SMALL_SAMPLE = 5;
  const previewSuppressed = freeTextCount < SMALL_SAMPLE;
  const freeTextPreview = previewSuppressed ? [] : preview.slice(0, 12);

  const insights = buildInsights(distributions, {
    total,
    completionRate,
    dropoff,
    freeTextCount,
    relevant: relevantCount,
    unclearOffTopic,
    tooShort: tooShortCount,
    scrubbed: freeTextScrubbed,
  });
  const themeSummary = buildThemeSummary(distributions, themeStats);

  return {
    total,
    completed,
    stopped,
    completionRate,
    byLang,
    freeTextCount,
    answeredCount,
    dropoff,
    distributions,
    volumeByDay,
    themeStats,
    insights,
    themeSummary,
    freeTextPreview,
    previewSuppressed,
    freeTextQuality: {
      relevance: relevanceBreakdown,
      quality: qualityBreakdown,
      scrubbed: freeTextScrubbed,
      total: freeTextCount,
      relevant: relevantCount,
      unclearOffTopic,
      tooShort: tooShortCount,
      ok: okCount,
    },
    surveyVersion: SURVEY.version,
  };
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function toCSV(sessions: SessionRecord[]): string {
  const header = [
    "session_id", "language", "status", "started_at",
    "question_id", "value", "free_text", "relevance", "pii_scrubbed",
    "is_relevant", "quality_flag", "length_band", "skipped", "answered_at",
  ];
  const lines = [header.join(",")];
  for (const s of sessions) {
    for (const a of s.answers) {
      const value = a.value == null ? "" : Array.isArray(a.value) ? a.value.join("|") : a.value;
      const ft = a.freeText ? scrub(a.freeText) : "";
      const q = a.freeText ? assessQuality(ft) : null;
      lines.push(
        [
          s.id, s.language, s.status, s.startedAt,
          a.questionId, String(value), ft, a.relevance ?? "",
          a.scrubbed ? "yes" : "",
          a.freeText ? (isRelevant(a.relevance) ? "yes" : "no") : "",
          q ? q.qualityFlag : "", q ? q.lengthBand : "",
          a.skipped ? "yes" : "", a.at,
        ]
          .map((x) => csvEscape(String(x)))
          .join(",")
      );
    }
  }
  return lines.join("\n");
}
