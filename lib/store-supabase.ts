import { getServiceClient } from "./supabase";
import type {
  SessionRecord,
  AnswerRecord,
  InteractionEvent,
} from "./types";

/**
 * Supabase (PostgreSQL) persistence backend (DATA_BACKEND=supabase).
 *
 * Maps the denormalised SessionRecord used by the app onto the normalised
 * schema in supabase/migrations/0001_init.sql:
 *   sessions, responses, interaction_events, consent_records, demographics
 *
 * Demographic answers (age_band/gender/area) are also projected into the
 * `demographics` table for convenient dashboard filtering.
 *
 * NOTE: uses the SERVICE ROLE client (server-only). Run the seed script first
 * (npm run seed) so survey_versions / questions exist for the foreign keys.
 */

// Multi-select values are stored as JSON so arrays round-trip cleanly.
function writeValue(v: AnswerRecord["value"]): string | null {
  if (v == null) return null;
  return Array.isArray(v) ? JSON.stringify(v) : String(v);
}
function readValue(s: string | null): string | string[] | undefined {
  if (s == null) return undefined;
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through */
    }
  }
  return s;
}

function demographicsFrom(answers: AnswerRecord[]) {
  const get = (id: string) => {
    const a = answers.find((x) => x.questionId === id && !x.skipped);
    if (!a || a.value == null) return null;
    return Array.isArray(a.value) ? a.value.join("|") : String(a.value);
  };
  return {
    age_band: get("age_band"),
    gender: get("gender"),
    area_coarse: get("area"),
  };
}

export async function saveSession(s: SessionRecord): Promise<void> {
  const db = getServiceClient();
  const id = s.id;

  // 1. session row
  const up = await db.from("sessions").upsert({
    id,
    language: s.language,
    survey_version: s.surveyVersion,
    status: s.status,
    started_at: s.startedAt,
    updated_at: s.updatedAt,
    completed_at: s.completedAt ?? null,
  });
  if (up.error) throw up.error;

  // 2. responses (replace set for this session)
  await db.from("responses").delete().eq("session_id", id);
  const responseRows = s.answers.map((a) => ({
    session_id: id,
    question_id: a.questionId,
    value: writeValue(a.value),
    free_text: a.freeText ?? null,
    pii_scrubbed: !!a.scrubbed,
    language: a.language,
    relevance_label: a.relevance ?? null,
    skipped: !!a.skipped,
    created_at: a.at,
  }));
  if (responseRows.length) {
    const r = await db.from("responses").insert(responseRows);
    if (r.error) throw r.error;
  }

  // 3. interaction events (replace set)
  await db.from("interaction_events").delete().eq("session_id", id);
  const eventRows = s.events.map((e) => ({
    session_id: id,
    type: e.type,
    question_id: e.questionId ?? null,
    created_at: e.at,
  }));
  if (eventRows.length) {
    const e = await db.from("interaction_events").insert(eventRows);
    if (e.error) throw e.error;
  }

  // 4. consent (replace)
  await db.from("consent_records").delete().eq("session_id", id);
  if (s.consent) {
    const c = await db.from("consent_records").insert({
      session_id: id,
      consent_version: s.consent.version,
      agreed: s.consent.agreed,
      created_at: s.consent.at,
    });
    if (c.error) throw c.error;
  }

  // 5. demographics (upsert by session_id PK)
  const demo = demographicsFrom(s.answers);
  if (demo.age_band || demo.gender || demo.area_coarse) {
    const d = await db.from("demographics").upsert({ session_id: id, ...demo });
    if (d.error) throw d.error;
  }
}

export async function createSession(s: SessionRecord): Promise<void> {
  await saveSession(s);
}

export async function getSession(id: string): Promise<SessionRecord | null> {
  const db = getServiceClient();
  const { data: session, error } = await db
    .from("sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!session) return null;

  const [{ data: responses }, { data: events }, { data: consent }] = await Promise.all([
    db.from("responses").select("*").eq("session_id", id).order("created_at"),
    db.from("interaction_events").select("*").eq("session_id", id).order("created_at"),
    db.from("consent_records").select("*").eq("session_id", id).order("created_at"),
  ]);

  return reassemble(session, responses ?? [], events ?? [], consent ?? []);
}

export async function listSessions(): Promise<SessionRecord[]> {
  const db = getServiceClient();
  const { data: sessions, error } = await db
    .from("sessions")
    .select("*")
    .order("started_at", { ascending: false });
  if (error) throw error;
  if (!sessions || sessions.length === 0) return [];

  const ids = sessions.map((s: any) => s.id);
  const [{ data: responses }, { data: events }, { data: consent }] = await Promise.all([
    db.from("responses").select("*").in("session_id", ids),
    db.from("interaction_events").select("*").in("session_id", ids),
    db.from("consent_records").select("*").in("session_id", ids),
  ]);

  const byId = (rows: any[] | null) => {
    const m: Record<string, any[]> = {};
    for (const r of rows ?? []) (m[r.session_id] ??= []).push(r);
    return m;
  };
  const rMap = byId(responses);
  const eMap = byId(events);
  const cMap = byId(consent);

  return sessions.map((s: any) =>
    reassemble(s, rMap[s.id] ?? [], eMap[s.id] ?? [], cMap[s.id] ?? [])
  );
}

export async function deleteSession(id: string): Promise<boolean> {
  const db = getServiceClient();
  // Children are removed via ON DELETE CASCADE.
  const { error } = await db.from("sessions").delete().eq("id", id);
  if (error) throw error;
  return true;
}

function reassemble(
  s: any,
  responses: any[],
  events: any[],
  consent: any[]
): SessionRecord {
  const answers: AnswerRecord[] = responses.map((r) => ({
    questionId: r.question_id,
    value: readValue(r.value),
    freeText: r.free_text ?? undefined,
    language: r.language,
    relevance: r.relevance_label ?? undefined,
    skipped: r.skipped || undefined,
    scrubbed: r.pii_scrubbed || undefined,
    at: r.created_at,
  }));
  const evs: InteractionEvent[] = events.map((e) => ({
    type: e.type,
    questionId: e.question_id ?? undefined,
    at: e.created_at,
  }));
  const c = consent[0];
  return {
    id: s.id,
    language: s.language,
    surveyVersion: s.survey_version,
    consent: c ? { agreed: c.agreed, version: c.consent_version, at: c.created_at } : null,
    status: s.status,
    answers,
    events: evs,
    startedAt: s.started_at,
    updatedAt: s.updated_at,
    completedAt: s.completed_at ?? undefined,
  };
}
