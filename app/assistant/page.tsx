"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/assistant";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/**
 * Endpoint 3 UI — general query / chat (streaming, bilingual).
 *
 * Standalone assistant for broad water-management / project questions. It is
 * intentionally NOT linked from the resident survey and holds no participant data.
 *
 * A language toggle (English / العربية) switches the WHOLE interface (labels +
 * RTL/LTR) and the language the assistant replies in. Replies stream token-by-token;
 * the conversation and language choice are kept in the browser only (localStorage).
 */
type Msg = ChatMessage & { source?: string; category?: string };

const KB_CATEGORIES = new Set([
  "water_context",
  "digital_tools_context",
  "project_context",
  "confidentiality_context",
]);

const STORE_KEY = "cfc_assistant_chat";
const LANG_KEY = "cfc_assistant_lang";
// Watchdog: if no bytes arrive for this long, abort the stream so the UI never hangs.
const STREAM_IDLE_TIMEOUT_MS = 40000;

const SUGGESTIONS: Record<Lang, string[]> = {
  en: [
    "What is this project about?",
    "Why is my tap water salty?",
    "How do I report a water leak?",
    "Do you store my name?",
  ],
  ar: [
    "ما هو هذا المشروع؟",
    "لماذا المياه مالحة؟",
    "كيف أبلغ عن تسرب المياه؟",
    "هل تحتفظون باسمي؟",
  ],
};

export default function Assistant() {
  const [lang, setLangState] = useState<Lang>("en");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const dir = lang === "ar" ? "rtl" : "ltr";

  // Restore language + conversation locally (no server-side chat history).
  useEffect(() => {
    try {
      const savedLang = localStorage.getItem(LANG_KEY);
      if (savedLang === "ar" || savedLang === "en") setLangState(savedLang);
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-30)));
    } catch {
      /* ignore */
    }
  }, [messages]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function setLang(l: Lang) {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;

    const history: Msg[] = [...messages, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    // Watchdog: abort if no data arrives within the idle timeout, so the UI never
    // hangs in streaming mode. Re-armed on the response and on every chunk.
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, STREAM_IDLE_TIMEOUT_MS);
    };
    const disarm = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    try {
      arm();
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `lang` tells the assistant which language to reply in.
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), lang }),
        signal: controller.signal,
      });
      arm();
      const source = res.headers.get("X-Assistant-Source") || undefined;
      const category = res.headers.get("X-Assistant-Category") || undefined;
      if (!res.ok || !res.body) throw new Error("no body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break; // stream finished normally
        arm(); // data arrived → reset the watchdog
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc, source, category };
          return copy;
        });
      }
      if (!acc) {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: "…", source, category };
          return copy;
        });
      }
    } catch (e: any) {
      const aborted = e?.name === "AbortError";
      setMessages((m) => {
        const copy = [...m];
        const partial = copy[copy.length - 1]?.content || "";
        let next: string;
        if (timedOut) {
          // stalled stream: keep any partial text, then the timeout notice
          next = partial ? `${partial}\n\n${t(lang, "assistant_timeout")}` : t(lang, "assistant_timeout");
        } else if (aborted) {
          // user pressed Stop: keep the partial answer (or a short note)
          next = partial || t(lang, "assistant_stopped");
        } else {
          // network / parse failure
          next = t(lang, "assistant_timeout");
        }
        copy[copy.length - 1] = { role: "assistant", content: next };
        return copy;
      });
    } finally {
      disarm();
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }
  function newChat() {
    abortRef.current?.abort();
    setMessages([]);
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  }

  const langBtn = (l: Lang, label: string) => (
    <button
      onClick={() => setLang(l)}
      className="btn-ghost"
      style={{
        color: "#fff",
        fontWeight: lang === l ? 700 : 400,
        textDecoration: lang === l ? "underline" : "none",
        opacity: lang === l ? 1 : 0.75,
      }}
      aria-pressed={lang === l}
    >
      {label}
    </button>
  );

  return (
    <div className="page" dir={dir} lang={lang}>
      <header className="app-header">
        <h1>{t(lang, "assistant_title")}</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ display: "flex", gap: 6 }}>
            {langBtn("en", "EN")}
            <span style={{ opacity: 0.4 }}>|</span>
            {langBtn("ar", "ع")}
          </span>
          {messages.length > 0 && (
            <button className="btn-ghost" onClick={newChat}>＋ {t(lang, "assistant_new")}</button>
          )}
          <a className="btn-ghost" href="/">↩ {t(lang, "assistant_survey")}</a>
        </div>
      </header>

      <main className="content">
        <div className="card" style={{ background: "var(--blue-light)", borderStyle: "dashed" }}>
          <p className="small" style={{ margin: 0 }}>
            <strong>{t(lang, "assistant_boundary")}</strong>
          </p>
          <p className="small" style={{ margin: "6px 0 0" }}>
            {t(lang, "assistant_note")}
          </p>
          <p className="small" style={{ margin: "6px 0 0" }}>
            {t(lang, "assistant_feedback_pre")}
            <a href="/">{t(lang, "assistant_feedback_link")}</a>.
          </p>
        </div>

        <div className="chat" ref={scrollRef} aria-live="polite" style={{ maxHeight: "52vh", overflowY: "auto" }}>
          {messages.length === 0 && <div className="bubble bot">{t(lang, "assistant_greeting")}</div>}
          {messages.map((m, i) => {
            const streaming = busy && i === messages.length - 1 && m.role === "assistant";
            const showLabel =
              m.role === "assistant" &&
              !streaming &&
              (m.source === "llm" || m.source === "offline") &&
              !!m.category &&
              KB_CATEGORIES.has(m.category);
            return (
              <div
                key={i}
                style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}
              >
                <div className={`bubble ${m.role === "user" ? "user" : "bot"}`} dir={dir}>
                  {m.content || (streaming ? "▍" : "")}
                  {streaming && m.content ? " ▍" : ""}
                </div>
                {showLabel && (
                  <div className="small" style={{ color: "var(--muted)", margin: "2px 4px 0", fontStyle: "italic" }} dir={dir}>
                    {t(lang, "assistant_based_on")} {t(lang, `assistant_cat_${m.category}`)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {messages.length === 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {SUGGESTIONS[lang].map((s) => (
              <button key={s} className="btn btn-secondary" style={{ width: "auto", fontSize: 13 }} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="answers" style={{ marginTop: 12 }}>
          <textarea
            className="free"
            dir={dir}
            placeholder={t(lang, "assistant_placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary" disabled={busy || !input.trim()} onClick={() => send()}>
              {t(lang, "assistant_send")}
            </button>
            {busy && (
              <button className="btn btn-secondary" style={{ width: "auto" }} onClick={stop}>
                ■ {t(lang, "assistant_stop")}
              </button>
            )}
          </div>
        </div>
      </main>

      <footer className="app-footer">{t(lang, "assistant_footer")}</footer>
    </div>
  );
}
