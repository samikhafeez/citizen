/**
 * Endpoint 3 (/assistant) guardrails: scope classification + retrieval.
 *
 * Before anything goes to the LLM, the user's question is classified. Only
 * in-scope questions proceed, and then only with approved context retrieved from
 * the synthetic knowledge base (lib/water-knowledge.ts). Out-of-scope and
 * advice/sensitive requests are answered with fixed messages and never reach the LLM.
 *
 * This module imports ONLY the synthetic knowledge base — no participant data.
 */
import { KNOWLEDGE, type KbEntry } from "./water-knowledge";

export type QueryCategory =
  | "water_context"
  | "digital_tools_context"
  | "project_context"
  | "confidentiality_context"
  | "out_of_scope"
  | "sensitive_or_advice_request";

export const SCOPE_MESSAGE =
  "I can only answer questions about water services, digital water tools, and this feedback project.";
export const ADVICE_MESSAGE =
  "I’m sorry, but I cannot provide advice or support for that. This tool is only for general water-service and project information.";

// ── text helpers (Arabic-aware) ──
const DIACRITICS = /[ً-ْ]/g;
function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(DIACRITICS, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه") // unify teh marbuta
    .replace(/ى/g, "ي"); // unify alef maqsura
}
function tokens(s: string): string[] {
  return normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
// Strip common Arabic leading clitics (و/ف/ب/ك/ل + ال) so "المياه" matches "مياه".
function deClitic(tok: string): string {
  const m = tok.match(/^(?:و|ف|ب|ك|ل)?(?:ال)?(.+)$/u);
  return m && m[1] && m[1].length >= 3 ? m[1] : tok;
}
/**
 * Token-level match that tolerates Arabic affixes without the false positives of
 * raw substring matching. Multi-word terms are matched as a phrase on the text.
 */
function tokenMatches(tok: string, term: string): boolean {
  const cands = tok === deClitic(tok) ? [tok] : [tok, deClitic(tok)];
  for (const c of cands) {
    if (c === term) return true;
    if (term.length >= 4 && c.startsWith(term)) return true; // suffix variations
    if (term.length >= 5 && c.includes(term)) return true; // infix for longer terms
  }
  return false;
}
function hasAny(text: string, terms: string[]): boolean {
  const full = normalize(text);
  const toks = tokens(text);
  for (const raw of terms) {
    const term = normalize(raw);
    if (term.includes(" ")) {
      if (full.includes(term)) return true;
      continue;
    }
    for (const tok of toks) if (tokenMatches(tok, term)) return true;
  }
  return false;
}
/** How many distinct terms from `terms` appear in `text` (used to pick the dominant category). */
function countMatches(text: string, terms: string[]): number {
  const full = normalize(text);
  const toks = tokens(text);
  let n = 0;
  for (const raw of terms) {
    const term = normalize(raw);
    if (term.includes(" ")) {
      if (full.includes(term)) n += 1;
    } else if (toks.some((tok) => tokenMatches(tok, term))) {
      n += 1;
    }
  }
  return n;
}

// ── keyword sets ──
// Emergency / advice / personal-crisis requests → refuse (no LLM).
const SENSITIVE_TERMS = [
  // emergency / medical
  "emergency", "ambulance", "hospital", "medical", "doctor", "medicine", "sick", "ill", "disease", "infection", "poison",
  // mental health / crisis / harm
  "suicide", "kill myself", "want to die", "self harm", "harm", "hurt", "hurting", "depressed", "abuse", "violence", "beaten", "threat", "unsafe", "danger",
  // legal / immigration
  "legal", "lawyer", "court", "sue", "immigration", "asylum", "visa", "deport", "residency", "permit", "refugee status", "resettlement",
  // financial / livelihood
  "loan", "money", "financial", "salary", "job", "work permit", "rent", "evict", "homeless",
  // political
  "political", "politics", "election", "vote", "government policy", "protest", "war",
  // humanitarian aid
  "aid", "humanitarian", "food assistance", "cash assistance", "shelter",
  // Arabic
  "طوارئ", "إسعاف", "مستشفى", "طبيب", "دواء", "مرض", "انتحار", "أؤذي نفسي", "اذي نفسي", "عنف", "ضرب", "تهديد", "خطر", "خائف",
  "محامي", "محكمة", "لجوء", "تأشيرة", "ترحيل", "إقامة", "توطين",
  "قرض", "مال", "راتب", "وظيفة", "إيجار", "طرد", "بلا مأوى",
  "سياسة", "انتخابات", "تصويت", "حرب", "احتجاج",
  "مساعدة", "إغاثة", "مساعدات", "مأوى",
];

const WATER_TERMS = [
  "water", "tap", "faucet", "pipe", "leak", "supply", "tank", "quality", "drink", "drinking", "shortage", "scarcity",
  "pressure", "outage", "cut", "tanker", "truck", "well", "pump", "sewage", "wastewater", "salty", "smell", "bill",
  "billing", "meter", "supply schedule", "drainage", "dirty", "clean", "conserve", "conservation", "save water", "preserve", "saving",
  "مياه", "ماء", "صنبور", "حنفية", "أنبوب", "تسرب", "إمداد", "خزان", "جودة", "شرب", "نقص", "ندرة", "ضغط", "انقطاع",
  "صهريج", "تنكر", "بئر", "مضخة", "صرف", "مالح", "رائحة", "فاتورة", "عداد", "ترشيد", "توفير", "حفظ المياه",
];
const DIGITAL_TERMS = [
  "app", "apps", "application", "tool", "tools", "whatsapp", "sms", "text message", "website", "portal", "online",
  "digital", "internet", "connectivity", "notification", "alert", "phone", "smartphone", "device", "data cost", "offline",
  "voice", "audio",
  "تطبيق", "واتساب", "رسالة", "موقع", "بوابة", "إنترنت", "رقمي", "اتصال", "إشعار", "تنبيه", "هاتف", "جهاز", "باقة", "صوت", "صوتيه",
];
const PROJECT_TERMS = [
  "project", "survey", "research", "study", "feedback", "questionnaire", "chatbot", "assistant", "themes",
  "what can you do", "what is this", "participate", "participation", "take part", "paid", "payment",
  "human", "robot", "bot", "real person", "refugee", "refugees",
  "official", "officially", "government", "ministry", "company", "represent", "who runs",
  "مشروع", "استبيان", "بحث", "دراسة", "رأي", "آراء", "روبوت", "مساعد", "محاور", "ما هذا", "ماذا تفعل",
  "مشاركه", "مدفوع", "إنسان", "بشري", "لاجئ", "لاجئين",
  "رسمي", "رسميه", "حكومه", "حكومي", "وزاره", "شركه", "جهه", "تمثل",
];
const CONF_TERMS = [
  "privacy", "private", "confidential", "anonymous", "data", "personal", "name", "address", "location", "gps", "track", "tracked", "phone number",
  "consent", "demographic", "gender", "age", "age band", "band", "optional", "delete", "withdraw", "secure", "id number",
  "خصوص", "خصوصية", "سري", "سرية", "مجهول", "بيانات", "شخصي", "شخصية", "اسم", "اسمي", "عنوان", "موقعي", "تحتفظ", "احتفاظ", "موافقة", "ديموغرافيا", "النوع", "اختياري", "حذف", "انسحاب", "امن", "هوية",
];

export function classify(query: string): QueryCategory {
  const q = (query || "").trim();
  if (!q) return "out_of_scope";
  // Safety first: advice / emergency / crisis / political → refuse, regardless of topic words.
  if (hasAny(q, SENSITIVE_TERMS)) return "sensitive_or_advice_request";

  // Score each in-scope category by how many of its terms match, then pick the
  // dominant one. This stops a single water word (e.g. "water") from overriding a
  // question that is really about privacy, digital tools, or the project itself.
  const scores: Record<QueryCategory, number> = {
    confidentiality_context: countMatches(q, CONF_TERMS),
    project_context: countMatches(q, PROJECT_TERMS),
    digital_tools_context: countMatches(q, DIGITAL_TERMS),
    water_context: countMatches(q, WATER_TERMS),
    out_of_scope: 0,
    sensitive_or_advice_request: 0,
  };
  // Tie-break order: most specific intent first (privacy > project > digital > water).
  const order: QueryCategory[] = [
    "confidentiality_context",
    "project_context",
    "digital_tools_context",
    "water_context",
  ];
  let best: QueryCategory = "out_of_scope";
  let bestScore = 0;
  for (const cat of order) {
    if (scores[cat] > bestScore) {
      best = cat;
      bestScore = scores[cat];
    }
  }
  return bestScore > 0 ? best : "out_of_scope";
}

// Common stopwords filtered out before scoring so retrieval ranks on meaningful terms.
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "do", "does", "did", "to", "of", "for", "in", "on", "at", "and", "or",
  "i", "you", "me", "my", "your", "it", "this", "that", "these", "those", "how", "what", "why", "when", "where",
  "can", "could", "would", "should", "will", "only", "some", "any", "with", "about", "from", "have", "has", "be",
  "هل", "في", "من", "علي", "ما", "هذا", "هذه", "و", "او", "كيف", "لماذا", "متي", "اين", "انا", "انت", "هل",
]);

// ── retrieval over the synthetic knowledge base ──
// Clitic-/affix-aware token match (mirrors classification) for better Arabic recall.
function tokMatch(a: string, b: string): boolean {
  const x = deClitic(a);
  const y = deClitic(b);
  if (x === y) return true;
  const min = Math.min(x.length, y.length);
  return min >= 4 && (x.startsWith(y) || y.startsWith(x));
}
function score(qTokens: string[], entry: KbEntry): number {
  const hay = tokens(`${entry.en} ${entry.ar}`);
  const kw = entry.keywords.flatMap((k) => tokens(k));
  let s = 0;
  for (const qt of qTokens) {
    if (hay.some((h) => tokMatch(qt, h))) s += 1;
    if (kw.some((h) => tokMatch(qt, h))) s += 1; // weight salient keywords
  }
  return s;
}

export function retrieve(query: string, k = 4, preferCategory?: QueryCategory): KbEntry[] {
  const qTokens = Array.from(new Set(tokens(query))).filter((t) => !STOPWORDS.has(t));
  let scored = KNOWLEDGE.map((e) => ({ e, s: score(qTokens, e) })).filter((x) => x.s > 0);
  if (scored.length === 0 && preferCategory) {
    // Fall back to a few entries from the matched category so context is never empty.
    return KNOWLEDGE.filter((e) => e.category === preferCategory).slice(0, k);
  }
  scored = scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map((x) => x.e);
}

export function buildContext(entries: KbEntry[], arabic: boolean): string {
  return entries.map((e) => `- ${arabic ? e.ar : e.en}`).join("\n");
}

export interface Decision {
  action: "answer" | "scope" | "refuse";
  category: QueryCategory;
  message?: string; // for scope/refuse
  entries?: KbEntry[]; // for answer
}

export function decide(query: string): Decision {
  const category = classify(query);
  if (category === "sensitive_or_advice_request") {
    return { action: "refuse", category, message: ADVICE_MESSAGE };
  }
  if (category === "out_of_scope") {
    return { action: "scope", category, message: SCOPE_MESSAGE };
  }
  const entries = retrieve(query, 4, category);
  return { action: "answer", category, entries };
}
