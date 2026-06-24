import { NextResponse } from "next/server";
import crypto from "crypto";
import { SURVEY } from "@/lib/survey-data";
import { checkRelevance } from "@/lib/relevance";
import { scrub } from "@/lib/scrub";
import {
  createSession,
  getSession,
  saveSession,
} from "@/lib/store";
import type { Lang, SessionRecord, AnswerRecord, InteractionEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/survey  → public survey configuration (questions live in the DB in prod)
export async function GET() {
  return NextResponse.json({ survey: SURVEY });
}

function now() {
  return new Date().toISOString();
}

function event(s: SessionRecord, type: InteractionEvent["type"], questionId?: string) {
  s.events.push({ type, questionId, at: now() });
}

// POST /api/survey  → start / consent / check / answer / skip / back / complete / stop
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body?.action as string;

  try {
    // ── start a new pseudonymous session ──
    if (action === "start") {
      const language: Lang = body.language === "ar" ? "ar" : "en";
      const session: SessionRecord = {
        id: crypto.randomUUID(),
        language,
        surveyVersion: SURVEY.version,
        consent: null,
        status: "started",
        answers: [],
        events: [{ type: "start", at: now() }],
        startedAt: now(),
        updatedAt: now(),
      };
      await createSession(session);
      return NextResponse.json({ sessionId: session.id });
    }

    // ── relevance check only (no persistence) ──
    if (action === "check") {
      const label = checkRelevance(String(body.text ?? ""));
      return NextResponse.json({ relevance: label });
    }

    // Everything below needs a valid session.
    const session = body.sessionId ? await getSession(body.sessionId) : null;
    if (!session) {
      return NextResponse.json({ error: "Unknown session" }, { status: 404 });
    }

    if (action === "consent") {
      const agreed = !!body.agreed;
      session.consent = { agreed, version: SURVEY.version, at: now() };
      event(session, "consent");
      if (!agreed) session.status = "stopped";
      session.updatedAt = now();
      await saveSession(session);
      return NextResponse.json({ ok: true });
    }

    if (action === "language") {
      session.language = body.language === "ar" ? "ar" : "en";
      session.updatedAt = now();
      await saveSession(session);
      return NextResponse.json({ ok: true });
    }

    if (action === "answer") {
      const questionId = String(body.questionId);
      // Scrub personal detail from free-text BEFORE it is stored. The raw input is
      // never persisted — only the scrubbed version is kept (v1: no raw field).
      const rawFree = body.freeText ? String(body.freeText) : undefined;
      const freeText = rawFree ? scrub(rawFree) : undefined;
      const record: AnswerRecord = {
        questionId,
        value: body.value,
        freeText,
        language: session.language,
        relevance: freeText ? checkRelevance(freeText) : undefined,
        scrubbed: freeText ? true : undefined,
        at: now(),
      };
      // replace any prior answer for this question (supports back + re-answer)
      session.answers = session.answers.filter((a) => a.questionId !== questionId);
      session.answers.push(record);
      event(session, "answer", questionId);
      session.updatedAt = now();
      await saveSession(session);
      return NextResponse.json({ ok: true, relevance: record.relevance ?? null });
    }

    if (action === "skip") {
      const questionId = String(body.questionId);
      session.answers = session.answers.filter((a) => a.questionId !== questionId);
      session.answers.push({
        questionId,
        skipped: true,
        language: session.language,
        at: now(),
      });
      event(session, "skip", questionId);
      session.updatedAt = now();
      await saveSession(session);
      return NextResponse.json({ ok: true });
    }

    if (action === "back") {
      event(session, "back", body.questionId ? String(body.questionId) : undefined);
      session.updatedAt = now();
      await saveSession(session);
      return NextResponse.json({ ok: true });
    }

    if (action === "complete") {
      session.status = "completed";
      session.completedAt = now();
      event(session, "complete");
      session.updatedAt = now();
      await saveSession(session);
      return NextResponse.json({ ok: true });
    }

    if (action === "stop") {
      session.status = "stopped";
      event(session, "stop");
      session.updatedAt = now();
      await saveSession(session);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Survey API action failed:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

