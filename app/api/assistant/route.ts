import { streamAnswer, type ChatMessage } from "@/lib/assistant";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Endpoint 3 API — general query / chat (streaming).
 *
 * Deliberately imports ONLY lib/assistant and lib/rate-limit. It does not (and
 * must not) import lib/store / lib/rag-lexical or any participant data. This
 * isolation is what lets it safely use an external LLM.
 *
 * Returns the reply as a streamed text/plain body so the client can render
 * tokens as they arrive. The backend used (llm | offline | limit) is reported
 * in the X-Assistant-Source header.
 *
 * A lightweight per-IP message cap protects against runaway use / cost before
 * any public exposure (this endpoint only — the survey and dashboard are unaffected).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMIT_MESSAGE =
  "This assistant has reached the temporary usage limit for this session. Please start a new session later.";
const TOO_LONG_MESSAGE =
  "Your message is too long for this prototype assistant. Please shorten it and try again.";

function maxMessages(): number {
  const n = parseInt(process.env.ASSISTANT_MAX_MESSAGES_PER_SESSION || "20", 10);
  return Number.isFinite(n) && n > 0 ? n : 20;
}
function maxInputChars(): number {
  const n = parseInt(process.env.ASSISTANT_MAX_INPUT_CHARS || "1200", 10);
  return Number.isFinite(n) && n > 0 ? n : 1200;
}
function windowMs(): number {
  const n = parseInt(process.env.ASSISTANT_RATE_WINDOW_MS || "3600000", 10); // default 1 hour
  return Number.isFinite(n) && n > 0 ? n : 3600000;
}
function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : "") || req.headers.get("x-real-ip") || "local";
  return ip.trim() || "local";
}
function textResponse(text: string, source: string, status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  return new Response(stream, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Assistant-Source": source,
    },
  });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const messages: ChatMessage[] = Array.isArray(body?.messages)
    ? body.messages
        .filter(
          (m: any) =>
            m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
        )
        .map((m: any) => ({ role: m.role, content: m.content }))
    : [];

  if (messages.length === 0) {
    return new Response("No messages", { status: 400 });
  }

  // Per-message input-length cap (this endpoint only). Reject overly long input
  // BEFORE calling the API. Checked on the latest user message.
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  if (lastUser.length > maxInputChars()) {
    return textResponse(TOO_LONG_MESSAGE, "too_long");
  }

  // Per-IP usage cap (this endpoint only). Streamed so the client renders it normally.
  const limit = rateLimit(`assistant:${clientKey(req)}`, maxMessages(), windowMs());
  if (!limit.allowed) {
    return textResponse(LIMIT_MESSAGE, "limit");
  }

  const lang = body?.lang === "ar" ? "ar" : body?.lang === "en" ? "en" : undefined;
  const { stream, source, category } = await streamAnswer(messages, lang);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Assistant-Source": source,
      // Friendly grounding label only; no technical IDs or retrieval scores are exposed.
      "X-Assistant-Category": category,
    },
  });
}
