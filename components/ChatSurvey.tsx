"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { nextQuestion, visibleQuestions, getQuestion, isVisible } from "@/lib/survey-engine";
import { assessQuality } from "@/lib/quality";
import {
  api,
  getLang,
  getSessionId,
  getCachedAnswers,
  setCachedAnswers,
  clearSession,
} from "@/lib/client";
import type { Survey, Question, AnswerRecord, Lang } from "@/lib/types";

type Bubble = { role: "bot" | "user" | "system"; text: string; tag?: string };

export default function ChatSurvey() {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("en");
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [note, setNote] = useState<Bubble | null>(null);
  const [sensitiveMode, setSensitiveMode] = useState(false);
  const [multi, setMulti] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // States for Review/Edit Phase
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editMulti, setEditMulti] = useState<string[]>([]);
  const [editText, setEditText] = useState("");
  const [editSensitiveMode, setEditSensitiveMode] = useState(false);
  const [editNote, setEditNote] = useState<Bubble | null>(null);
  // One gentle nudge per free-text question (off-topic OR low quality), then accept.
  const nudgedOnce = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load language, cached answers and survey config.
  useEffect(() => {
    setLang(getLang());
    setAnswers(getCachedAnswers());
    if (!getSessionId()) {
      router.replace("/consent");
      return;
    }
    fetch("/api/survey")
      .then((r) => r.json())
      .then((d) => setSurvey(d.survey))
      .catch(() => {});
  }, [router]);

  const current = useMemo(
    () => (survey ? nextQuestion(survey, answers) : null),
    [survey, answers]
  );

  const visible = useMemo(
    () => (survey ? visibleQuestions(survey, answers) : []),
    [survey, answers]
  );

  // Reset transient per-question input when the current question changes.
  useEffect(() => {
    setMulti([]);
    setText("");
    setSensitiveMode(false);
    setNote(null);
  }, [current?.id]);

  // Persist answers cache when changed.
  useEffect(() => {
    if (!survey) return;
    setCachedAnswers(answers);
  }, [answers, survey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [answers, note, current?.id]);

  if (!survey) return <p className="lead">{t(lang, "loading")}</p>;

  // ── transcript (derived from answers) ──
  const transcript: Bubble[] = [];
  for (const q of survey.questions) {
    if (!visible.includes(q) && !answers.find((a) => a.questionId === q.id)) continue;
    const a = answers.find((x) => x.questionId === q.id);
    if (!a) continue;
    transcript.push({ role: "bot", text: q.prompt[lang] });
    transcript.push({ role: "user", text: answerText(q, a, lang) });
  }
  if (current) transcript.push({ role: "bot", text: current.prompt[lang] });

  const answeredVisible = visible.filter((q) => answers.find((a) => a.questionId === q.id)).length;
  const pct = visible.length ? Math.round((answeredVisible / visible.length) * 100) : 0;
  const qIndex = Math.min(answeredVisible + 1, visible.length);

  // ── actions ──
  function commit(next: AnswerRecord) {
    setAnswers((prev) => [...prev.filter((a) => a.questionId !== next.questionId), next]);
  }

  async function submitClosed(value: string | string[]) {
    if (!current) return;
    setBusy(true);
    const sid = getSessionId();
    const rec: AnswerRecord = {
      questionId: current.id,
      value,
      language: lang,
      at: new Date().toISOString(),
    };
    if (sid) await api("answer", { sessionId: sid, questionId: current.id, value });
    commit(rec);
    setBusy(false);
  }

  async function submitFree() {
    if (!current) return;
    const trimmed = text.trim();
    if (trimmed === "") return skip();
    setBusy(true);
    const res = await api("check", { text: trimmed });
    const label = res?.relevance as string;

    if (label === "sensitive") {
      setNote({ role: "system", text: t(lang, "ack_sensitive"), tag: "sensitive" });
      setSensitiveMode(true);
      setBusy(false);
      return;
    }
    // One gentle nudge per question for off-topic OR low-quality text; then accept.
    const offTopic = label === "off_topic" || label === "unclear";
    const { qualityFlag } = assessQuality(trimmed);
    const lowQuality = qualityFlag !== "ok";
    if ((offTopic || lowQuality) && !nudgedOnce.current.has(current.id)) {
      nudgedOnce.current.add(current.id);
      const noteText = offTopic
        ? label === "off_topic"
          ? t(lang, "redirect_offtopic")
          : t(lang, "redirect_unclear")
        : t(lang, "quality_more_detail");
      setNote({ role: "system", text: noteText, tag: "offtopic" });
      setBusy(false);
      return;
    }

    // Accept and save.
    const sid = getSessionId();
    const rec: AnswerRecord = {
      questionId: current.id,
      freeText: trimmed,
      language: lang,
      at: new Date().toISOString(),
    };
    if (sid) await api("answer", { sessionId: sid, questionId: current.id, freeText: trimmed });
    commit(rec);
    setBusy(false);
  }

  async function skip() {
    if (!current) return;
    setBusy(true);
    const sid = getSessionId();
    if (sid) await api("skip", { sessionId: sid, questionId: current.id });
    commit({ questionId: current.id, skipped: true, language: lang, at: new Date().toISOString() });
    setBusy(false);
  }

  async function back() {
    // Remove the most recently answered visible question.
    const answeredQs = survey!.questions.filter((q) => answers.find((a) => a.questionId === q.id));
    const last = answeredQs[answeredQs.length - 1];
    if (!last) return;
    const sid = getSessionId();
    if (sid) await api("back", { sessionId: sid, questionId: last.id });
    setAnswers((prev) => prev.filter((a) => a.questionId !== last.id));
    nudgedOnce.current.delete(last.id);
  }

  async function stop() {
    const sid = getSessionId();
    if (sid) await api("stop", { sessionId: sid });
    router.push("/complete?stopped=1");
  }

  async function submitSurvey() {
    setBusy(true);
    const sid = getSessionId();
    if (sid) {
      await api("complete", { sessionId: sid });
    }
    clearSession();
    router.push("/complete");
  }

  function startEdit(questionId: string) {
    const q = getQuestion(survey!, questionId);
    if (!q) return;
    const a = answers.find((x) => x.questionId === questionId);
    setEditingQuestionId(questionId);
    setEditNote(null);
    setEditSensitiveMode(false);
    if (q.type === "multiple") {
      setEditMulti(Array.isArray(a?.value) ? a.value : a?.value ? [a.value] : []);
    } else if (q.type === "freetext") {
      setEditText(a?.freeText || "");
    }
  }

  async function saveEdit(value?: string | string[], freeText?: string) {
    if (!editingQuestionId || !survey) return;
    const q = getQuestion(survey, editingQuestionId);
    if (!q) return;

    setBusy(true);
    const sid = getSessionId();

    const record: AnswerRecord = {
      questionId: editingQuestionId,
      value: value ?? undefined,
      freeText: freeText ?? undefined,
      language: lang,
      at: new Date().toISOString(),
    };

    if (q.type === "freetext" && freeText) {
      const res = await api("check", { text: freeText });
      const label = res?.relevance as string;

      if (label === "sensitive" && !editSensitiveMode) {
        setEditNote({ role: "system", text: t(lang, "ack_sensitive"), tag: "sensitive" });
        setEditSensitiveMode(true);
        setBusy(false);
        return;
      }
      
      const offTopic = label === "off_topic" || label === "unclear";
      const { qualityFlag } = assessQuality(freeText);
      const lowQuality = qualityFlag !== "ok";
      if ((offTopic || lowQuality) && !nudgedOnce.current.has(editingQuestionId)) {
        nudgedOnce.current.add(editingQuestionId);
        const noteText = offTopic
          ? label === "off_topic"
            ? t(lang, "redirect_offtopic")
            : t(lang, "redirect_unclear")
          : t(lang, "quality_more_detail");
        setEditNote({ role: "system", text: noteText, tag: "offtopic" });
        setBusy(false);
        return;
      }
      record.freeText = freeText.trim();
      record.scrubbed = true;
    }

    if (sid) {
      if (q.type === "freetext") {
        await api("answer", { sessionId: sid, questionId: editingQuestionId, freeText: record.freeText });
      } else {
        await api("answer", { sessionId: sid, questionId: editingQuestionId, value: record.value });
      }
    }

    setAnswers((prev) => {
      const updated = [...prev.filter((a) => a.questionId !== editingQuestionId), record];
      // Clean up answers for questions that are no longer visible due to skips/branching changes
      return updated.filter((a) => {
        const question = getQuestion(survey, a.questionId);
        return question ? isVisible(question, updated) : true;
      });
    });

    setEditingQuestionId(null);
    setBusy(false);
  }

  const canBack = answers.length > 0;

  // ── Render Editing Mode ──
  if (editingQuestionId !== null) {
    const q = getQuestion(survey, editingQuestionId);
    if (!q) return null;
    return (
      <div className="admin-wrap" dir={lang === "ar" ? "rtl" : "ltr"} style={{ maxWidth: 600, margin: "0 auto", padding: "10px 0" }}>
        <h2 className="title" style={{ fontSize: 18 }}>{t(lang, "edit_title")}: {q.prompt[lang]}</h2>
        
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          <AnswerControls
            q={q}
            lang={lang}
            multi={editMulti}
            setMulti={setEditMulti}
            text={editText}
            setText={setEditText}
            busy={busy}
            sensitiveMode={editSensitiveMode}
            onClosed={(val) => saveEdit(val)}
            onFree={() => saveEdit(undefined, editText)}
          />
          {editNote && <div className="bubble system" style={{ marginTop: 12 }}>{editNote.text}</div>}
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setEditingQuestionId(null)} disabled={busy}>
            {t(lang, "cancel")}
          </button>
        </div>
      </div>
    );
  }

  // ── Render Review Mode (when all visible questions are answered) ──
  if (current === null) {
    const answeredVisibleQs = visible.filter((q) => answers.find((a) => a.questionId === q.id));
    return (
      <div className="admin-wrap" dir={lang === "ar" ? "rtl" : "ltr"} style={{ maxWidth: 600, margin: "0 auto", padding: "10px 0" }}>
        <h2 className="title" style={{ fontSize: 20 }}>{t(lang, "review_title")}</h2>
        <p className="small" style={{ marginBottom: 12 }}>{t(lang, "review_subtitle")}</p>
        
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "50vh", overflowY: "auto", padding: 16, marginBottom: 12 }}>
          {answeredVisibleQs.map((q) => {
            const a = answers.find((x) => x.questionId === q.id);
            if (!a) return null;
            return (
              <div key={q.id} className="review-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: "var(--navy)", fontSize: 13 }}>{q.prompt[lang]}</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "#555" }}>{answerText(q, a, lang)}</div>
                </div>
                <button className="btn btn-secondary" style={{ width: "auto", padding: "4px 8px", fontSize: 11 }} onClick={() => startEdit(q.id)} disabled={busy}>
                  {t(lang, "edit")}
                </button>
              </div>
            );
          })}
        </div>

        <div className="small" style={{ color: "#a23", display: "flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          ⚠️ {t(lang, "submit_warning")}
        </div>
        
        <div style={{ display: "flex", gap: 12 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={submitSurvey}>
            {busy ? t(lang, "saving") : t(lang, "submit_survey")}
          </button>
          <button className="btn btn-ghost" style={{ width: "auto" }} onClick={stop} disabled={busy}>
            {t(lang, "stop")}
          </button>
        </div>
      </div>
    );
  }

  // ── Render Normal Chat Mode ──
  return (
    <div>
      <div className="progress-label">
        {t(lang, "progress_label").replace("{n}", String(qIndex)).replace("{total}", String(visible.length))}
      </div>
      <div className="progress" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>

      <div className="chat" ref={scrollRef} style={{ maxHeight: "52vh", overflowY: "auto", paddingBottom: 6 }}>
        {transcript.map((b, i) => (
          <div key={i} className={`bubble ${b.role}`}>
            {b.text}
          </div>
        ))}
        {note && <div className={`bubble system`}>{note.text}</div>}
      </div>

      {current && (
        <div className="answers">
          <AnswerControls
            q={current}
            lang={lang}
            multi={multi}
            setMulti={setMulti}
            text={text}
            setText={setText}
            busy={busy}
            sensitiveMode={sensitiveMode}
            onClosed={submitClosed}
            onFree={submitFree}
          />
          <div className="controls">
            <div className="left">
              <button className="btn btn-secondary" onClick={back} disabled={!canBack || busy}>
                ← {t(lang, "back")}
              </button>
            </div>
            <div className="right">
              <button className="btn btn-secondary" onClick={skip} disabled={busy}>
                {t(lang, "skip")}
              </button>
              <button className="btn btn-ghost" onClick={stop} disabled={busy}>
                {t(lang, "stop")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AnswerControls({
  q,
  lang,
  multi,
  setMulti,
  text,
  setText,
  busy,
  sensitiveMode,
  onClosed,
  onFree,
}: {
  q: Question;
  lang: Lang;
  multi: string[];
  setMulti: (v: string[]) => void;
  text: string;
  setText: (v: string) => void;
  busy: boolean;
  sensitiveMode: boolean;
  onClosed: (v: string | string[]) => void;
  onFree: () => void;
}) {
  if (q.type === "single" || q.type === "yesno") {
    return (
      <>
        {q.options!.map((o) => (
          <button key={o.value} className="opt" disabled={busy} onClick={() => onClosed(o.value)}>
            {o.label[lang]}
          </button>
        ))}
      </>
    );
  }

  if (q.type === "multiple") {
    const toggle = (v: string) =>
      setMulti(multi.includes(v) ? multi.filter((x) => x !== v) : [...multi, v]);
    return (
      <>
        <div className="small">{t(lang, "choose_any")}</div>
        {q.options!.map((o) => (
          <button
            key={o.value}
            className={`opt ${multi.includes(o.value) ? "selected" : ""}`}
            disabled={busy}
            onClick={() => toggle(o.value)}
          >
            {multi.includes(o.value) ? "☑ " : "☐ "}
            {o.label[lang]}
          </button>
        ))}
        <button
          className="btn btn-primary"
          style={{ marginTop: 8 }}
          disabled={busy || multi.length === 0}
          onClick={() => onClosed(multi)}
        >
          {t(lang, "done_choosing")}
        </button>
      </>
    );
  }

  if (q.type === "scale") {
    return (
      <>
        <div className="scale">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className="opt" disabled={busy} onClick={() => onClosed(String(n))}>
              {n}
            </button>
          ))}
        </div>
        <div className="controls" style={{ marginTop: 4 }}>
          <span className="small">{q.scaleLabels?.low[lang]}</span>
          <span className="small">{q.scaleLabels?.high[lang]}</span>
        </div>
      </>
    );
  }
  // freetext
  return (
    <>
      <div className="small">{t(lang, "optional_hint")}</div>
      <textarea
        className="free"
        placeholder={t(lang, "type_here")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <div className="small" style={{ color: "#a23", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
        ⚠️ {lang === "ar" 
          ? "تجنب كتابة الأسماء، أو أرقام الهواتف، أو العناوين التفصيلية، أو الأحداث الشخصية."
          : "Avoid typing names, phone numbers, exact addresses, or personal events."}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy} onClick={onFree}>
        {sensitiveMode ? t(lang, "continue") : t(lang, "next")}
      </button>
    </>
  );
}

function answerText(q: Question, a: AnswerRecord, lang: Lang): string {
  if (a.skipped) return "—";
  if (a.freeText) return a.freeText;
  if (a.value == null) return "—";
  const vals = Array.isArray(a.value) ? a.value : [a.value];
  if (q.type === "scale") return vals.join(", ");
  const labels = vals.map((v) => q.options?.find((o) => o.value === v)?.label[lang] ?? v);
  return labels.join("، ");
}
