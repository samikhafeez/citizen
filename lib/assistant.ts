/**
 * Endpoint 3 — General query / chat assistant.
 *
 * ISOLATION (critical): this module must NEVER import the participant data store
 * (lib/store, lib/store-*, lib/rag-lexical) or read survey responses. It uses ONLY
 * the approved synthetic knowledge base (lib/water-knowledge.ts) via the guardrails
 * module. Because no confidential participant data ever reaches it, using an
 * external LLM/API here is acceptable — unlike the resident chatbot (no LLM) and
 * the researcher RAG layer (anonymised data, local-first).
 *
 * Flow: classify the question → if out-of-scope or an advice/sensitive request,
 * return a fixed message WITHOUT calling the LLM → otherwise retrieve approved
 * context and answer strictly from it (streamed).
 *
 * Provider: any OpenAI-compatible Chat Completions API, configured by env:
 *   ASSISTANT_API_KEY (or OPENAI_API_KEY), ASSISTANT_BASE_URL, ASSISTANT_MODEL.
 * If no key is set, a safe OFFLINE fallback answers from the approved knowledge base.
 */
import { decide, buildContext, type QueryCategory } from "./assistant-guardrails";
import type { KbEntry } from "./water-knowledge";

export type ChatRole = "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}
export type AssistantSource = "llm" | "offline" | "scope" | "refuse";
export interface AssistantReply {
  answer: string;
  source: AssistantSource;
}

const SYSTEM_PROMPT = `You are a helpful, careful information assistant for an academic research project called
"Citizen Feedback on Digital Technology in Water Management" in Jordan.

You CAN give brief, GENERAL, high-level information about: water services and shortages;
water-quality concerns in general terms; digital water tools (apps, SMS, WhatsApp, websites);
how residents can report or describe water problems in general; broad water-saving awareness;
and how this feedback project and its confidentiality work. Prefer the approved context below;
you may add short general explanations, but keep answers simple and brief, and be genuinely useful.

You MUST NOT:
- give personalised advice, or step-by-step or official instructions;
- give emergency, medical or safety advice, or say whether water is safe to drink;
- give treatment, boiling or filtering instructions;
- give legal, immigration, financial, political or crisis advice;
- claim to represent any government, water company, NGO, the UN, or a university;
- invent specific local facts, authorities, phone numbers, websites, procedures, guaranteed
  timelines or service commitments;
- ask for or repeat personal details (names, phone numbers, exact addresses, ID numbers).

For a specific service or safety problem, explain in general terms that the resident should use
an appropriate official channel — without naming one or giving any contact details. If a request
is outside water services, digital water tools, or this project, say briefly that you can only
help with those topics. You have no access to participant survey answers. Reply in the user's
language (Arabic or English).

STYLE — keep every answer short, precise and plain:
- Normally 2–4 sentences. Never use bullet lists or headings unless the user explicitly asks for a list.
- No promotional or vague phrasing (avoid "projects like this aim to…", "we are committed to…").
- No confident claims about outcomes (never say a provider "will resolve" or "is equipped to fix" anything).
- Prefer cautious wording: "general information", "an appropriate official channel", "this assistant cannot assess specific cases".
- Do not list detailed causes, procedures, or health/safety steps.

Examples of the expected tone (do not quote these verbatim):
Q: How can I report a leak?
A: If using an official reporting channel or digital tool, useful details may include the general area, when you noticed the leak, and what you observed. Please do not share names, phone numbers, exact addresses, or ID numbers with this assistant.
Q: Why is my water dirty?
A: Water can sometimes look unusual in colour, smell, or clarity. This assistant cannot assess the cause or say whether it is safe. The project collects general feedback about water-quality experiences, but specific concerns should be checked through an appropriate official channel.`;

const DISCLAIMER_EN = "General information only — not advice, and not connected to your survey answers.";
const DISCLAIMER_AR = "معلومات عامة فقط — وليست نصيحة، وغير مرتبطة بإجابات الاستبيان.";

// Arabic versions of the fixed scope/refusal messages (DRAFT — needs native + ethics review).
// decide() still returns the canonical English text (used by the eval); these are only
// substituted at response time when the chosen language is Arabic.
const SCOPE_MESSAGE_AR = "يمكنني فقط الإجابة عن أسئلة حول خدمات المياه والأدوات الرقمية للمياه وهذا المشروع.";
const ADVICE_MESSAGE_AR = "عذرًا، لا يمكنني تقديم نصيحة أو دعم بشأن ذلك. هذه الأداة مخصّصة للمعلومات العامة حول خدمة المياه والمشروع فقط.";

function refusalMessage(action: "scope" | "refuse", englishFallback: string, arabic: boolean): string {
  if (!arabic) return englishFallback;
  return action === "scope" ? SCOPE_MESSAGE_AR : ADVICE_MESSAGE_AR;
}

/** Heuristic: is the latest user message mostly Arabic? */
function isArabic(text: string): boolean {
  const arabic = (text.match(/[؀-ۿ]/g) || []).length;
  return arabic > Math.max(2, text.replace(/\s/g, "").length * 0.2);
}
export function disclaimerFor(text: string): string {
  return isArabic(text) ? DISCLAIMER_AR : DISCLAIMER_EN;
}

function systemWithContext(entries: KbEntry[], arabic: boolean): string {
  const context = buildContext(entries, arabic);
  const replyIn = arabic ? "Reply in Arabic." : "Reply in English.";
  return `${SYSTEM_PROMPT}\n\n${replyIn}\n\nApproved context (prefer this as your source; you may add a brief general explanation, but do not invent specific local facts, authorities or contacts):\n${context}`;
}

/** Resolve the reply language: explicit choice from the UI, else detect from the text. */
function resolveArabic(text: string, lang?: "en" | "ar"): boolean {
  if (lang === "ar") return true;
  if (lang === "en") return false;
  return isArabic(text);
}

/** Offline answer built strictly from the approved knowledge base. */
function offlineFromEntries(entries: KbEntry[], arabic: boolean): string {
  if (entries.length === 0) {
    return arabic
      ? "ليست لديّ معلومات معتمدة عن ذلك. يمكنني المساعدة في أسئلة عامة حول خدمات المياه والأدوات الرقمية وهذا المشروع."
      : "I don't have approved information about that. I can help with general questions about water services, digital tools, and this project.";
  }
  // Keep the offline answer short: the single most relevant approved entry.
  const top = arabic ? entries[0].ar : entries[0].en;
  const note = arabic ? "\n\n(وضع عدم الاتصال — معلومات معتمدة عامة.)" : "\n\n(Offline mode — general approved information.)";
  return top + note;
}

// ── LLM provider (OpenAI-compatible) ──
async function callLLM(messages: ChatMessage[], systemContent: string): Promise<string | null> {
  const key = process.env.ASSISTANT_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return null;
  const base = process.env.ASSISTANT_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.ASSISTANT_MODEL || "gpt-4o-mini";
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 200,
        messages: [{ role: "system", content: systemContent }, ...messages],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content.trim() : null;
  } catch {
    return null;
  }
}

function trim(messages: ChatMessage[]): ChatMessage[] {
  // Keep only recent turns; never includes participant data by construction.
  return messages.slice(-8).map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 2000) }));
}
function lastUser(messages: ChatMessage[]): string {
  return [...messages].reverse().find((m) => m.role === "user")?.content || "";
}

/** Non-streaming reply (used in tests / fallback). Applies the same guardrails. */
export async function ask(messages: ChatMessage[], lang?: "en" | "ar"): Promise<AssistantReply> {
  const last = lastUser(messages);
  const d = decide(last);
  if (d.action === "scope") return { answer: d.message!, source: "scope" };
  if (d.action === "refuse") return { answer: d.message!, source: "refuse" };
  const arabic = resolveArabic(last, lang);
  const system = systemWithContext(d.entries!, arabic);
  const llm = await callLLM(trim(messages), system);
  if (llm) return { answer: llm, source: "llm" };
  return { answer: offlineFromEntries(d.entries!, arabic), source: "offline" };
}

// ── Streaming (responsive UX) ──
// If no LLM token arrives within this window, treat the stream as stalled.
const SERVER_READ_IDLE_MS = 20000;

/** reader.read() with an idle timeout; rejects if no chunk arrives in `ms`. */
function readWithIdle<T>(
  reader: ReadableStreamDefaultReader<T>,
  ms: number
): Promise<ReadableStreamReadResult<T>> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("idle")), ms);
  });
  return Promise.race([
    reader.read().then((r) => {
      clearTimeout(timer);
      return r;
    }),
    timeout,
  ]);
}

/**
 * Stream the LLM reply, but if the API stream fails / stalls / errors and has
 * produced NO output yet, fall back to the approved knowledge-base answer
 * (`fallbackText`) within the SAME response. The API is never called again, and
 * the stream always closes cleanly so the client never sees an error for an
 * in-scope question. Used only when an API key is configured.
 */
function llmStreamWithFallback(
  messages: ChatMessage[],
  systemContent: string,
  fallbackText: string
): ReadableStream<Uint8Array> {
  const key = process.env.ASSISTANT_API_KEY || process.env.OPENAI_API_KEY;
  const base = process.env.ASSISTANT_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.ASSISTANT_MODEL || "gpt-4o-mini";
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let emitted = false;
      const abort = new AbortController();
      try {
        const upstream = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 400,
            stream: true,
            messages: [{ role: "system", content: systemContent }, ...messages],
          }),
          signal: abort.signal,
        });
        if (!upstream.ok || !upstream.body) throw new Error(`status ${upstream.status}`);

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;
        try {
          while (!done) {
            const chunk = await readWithIdle(reader, SERVER_READ_IDLE_MS); // throws on stall
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const tl = line.trim();
              if (!tl.startsWith("data:")) continue;
              const data = tl.slice(5).trim();
              if (data === "[DONE]") {
                done = true;
                break;
              }
              try {
                const json = JSON.parse(data);
                const delta: string | undefined = json?.choices?.[0]?.delta?.content;
                if (delta) {
                  controller.enqueue(encoder.encode(delta));
                  emitted = true;
                }
              } catch {
                /* ignore keep-alive / partial lines */
              }
            }
          }
        } finally {
          try {
            abort.abort();
          } catch {
            /* ignore */
          }
          reader.cancel().catch(() => {});
        }
      } catch {
        /* fetch failed / stalled / errored — fall through to the KB fallback */
      }

      // If the LLM produced nothing, serve the approved knowledge-base answer.
      if (!emitted) controller.enqueue(encoder.encode(fallbackText));
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });
}

function textToStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

/**
 * Streamed reply + the source used. Guardrails decide first: out-of-scope and
 * advice/sensitive requests return a fixed message and NEVER call the LLM.
 */
export async function streamAnswer(
  messages: ChatMessage[],
  lang?: "en" | "ar"
): Promise<{ stream: ReadableStream<Uint8Array>; source: AssistantSource; category: QueryCategory }> {
  const last = lastUser(messages);
  const arabic = resolveArabic(last, lang);
  const d = decide(last);
  if (d.action === "scope")
    return { stream: textToStream(refusalMessage("scope", d.message!, arabic)), source: "scope", category: d.category };
  if (d.action === "refuse")
    return { stream: textToStream(refusalMessage("refuse", d.message!, arabic)), source: "refuse", category: d.category };

  // In-scope: the approved KB answer is the guaranteed fallback for this question.
  const system = systemWithContext(d.entries!, arabic);
  const fallback = offlineFromEntries(d.entries!, arabic);
  const key = process.env.ASSISTANT_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) {
    // No API configured → answer directly from the approved knowledge base.
    return { stream: textToStream(fallback), source: "offline", category: d.category };
  }
  // API configured → stream the LLM, but fall back to the KB answer if it fails.
  return { stream: llmStreamWithFallback(trim(messages), system, fallback), source: "llm", category: d.category };
}
