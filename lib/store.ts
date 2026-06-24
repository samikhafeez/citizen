import type { SessionRecord } from "./types";
import * as fileStore from "./store-file";
import * as supabaseStore from "./store-supabase";

/**
 * Persistence facade. Chooses the backend at call time based on DATA_BACKEND:
 *   - "supabase" → Supabase/PostgreSQL (store-supabase.ts)
 *   - anything else (default) → local file store (store-file.ts)
 *
 * The Supabase module is only touched when selected, so no keys are needed
 * for local file-store development. The API routes import only from here.
 */
function backend() {
  return process.env.DATA_BACKEND === "supabase" ? supabaseStore : fileStore;
}

export function createSession(s: SessionRecord): Promise<void> {
  return backend().createSession(s);
}
export function getSession(id: string): Promise<SessionRecord | null> {
  return backend().getSession(id);
}
export function saveSession(s: SessionRecord): Promise<void> {
  return backend().saveSession(s);
}
export function listSessions(): Promise<SessionRecord[]> {
  return backend().listSessions();
}
export function deleteSession(id: string): Promise<boolean> {
  return backend().deleteSession(id);
}
