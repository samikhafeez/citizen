import { listSessions } from "./store";
import { SURVEY } from "./survey-data";
import { scrub } from "./scrub";

// Re-export so existing importers (e.g. the admin route) keep working.
export { scrub };

/**
 * In-dashboard RAG preview (Phase 2, lexical mode).
 *
 * A lightweight, dependency-free retriever + extractive grounded summary that
 * runs inside the Next app so researchers can try the query flow immediately.
 * It retrieves real free-text answers by term overlap and presents them grouped
 * by theme WITH CITATIONS — it never generates new claims, so it cannot
 * hallucinate. Personal detail is scrubbed before display.
 *
 * The full semantic pipeline (local multilingual embeddings + optional local
 * LLM summarisation) lives in analysis/ and is used for deeper July analysis.
 */

const DIACRITICS = /[ً-ْ]/g;

function normalize(s: string): string {
  return (s || "").toLowerCase().replace(DIACRITICS, "").replace(/[أإآ]/g, "ا");
}
function tokens(s: string): string[] {
  return normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
function themeOf(qid: string): string {
  return SURVEY.questions.find((q) => q.id === qid)?.theme ?? "";
}

export interface RagHit {
  responseRef: string;
  questionId: string;
  theme: string;
  language: string;
  text: string;
  score: number;
  createdAt?: string;
}

export interface RagResult {
  summary: string;
  sources: RagHit[];
  totalFreeText: number;
}

async function gatherChunks(): Promise<Omit<RagHit, "score">[]> {
  const sessions = await listSessions();
  const chunks: Omit<RagHit, "score">[] = [];
  for (const s of sessions) {
    for (const a of s.answers) {
      if (a.skipped || !a.freeText) continue;
      chunks.push({
        responseRef: `${s.id.slice(0, 8)}:${a.questionId}`,
        questionId: a.questionId,
        theme: themeOf(a.questionId),
        language: a.language,
        text: scrub(a.freeText),
        createdAt: a.at,
      });
    }
  }
  return chunks;
}

function score(queryTokens: string[], text: string): number {
  const counts = new Map<string, number>();
  for (const t of tokens(text)) counts.set(t, (counts.get(t) || 0) + 1);
  let distinct = 0;
  let occ = 0;
  for (const qt of queryTokens) {
    const c = counts.get(qt) || 0;
    if (c > 0) {
      distinct += 1;
      occ += c;
    }
  }
  return distinct + 0.1 * occ;
}

function buildSummary(query: string, hits: RagHit[]): string {
  if (hits.length === 0) {
    return `No matching free-text answers were found for "${query}", so no conclusion can be drawn.`;
  }
  const byTheme = new Map<string, RagHit[]>();
  for (const h of hits) {
    const key = h.theme || "other";
    if (!byTheme.has(key)) byTheme.set(key, []);
    byTheme.get(key)!.push(h);
  }
  const lines: string[] = [
    `Grounded summary for: "${query}"`,
    `(extractive — drawn directly from ${hits.length} retrieved answer(s); no model used)`,
    "",
  ];
  for (const [theme, items] of byTheme) {
    lines.push(`• ${theme} (${items.length}):`);
    for (const h of items) {
      const dateStr = h.createdAt ? ` [${h.createdAt.slice(0, 16).replace("T", " ")}]` : "";
      lines.push(`    - "${h.text}"  [${h.responseRef}]${dateStr}`);
    }
  }
  return lines.join("\n");
}

export async function ragQuery(query: string, k = 6): Promise<RagResult> {
  const chunks = await gatherChunks();
  const qTokens = Array.from(new Set(tokens(query)));
  const scored = chunks
    .map((c) => ({ ...c, score: score(qTokens, c.text) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return { summary: buildSummary(query, scored), sources: scored, totalFreeText: chunks.length };
}
