import { promises as fs } from "fs";
import path from "path";
import type { SessionRecord } from "./types";

/**
 * File-based persistence (default dev backend, DATA_BACKEND=file).
 * A JSON file under .data/store.json. Lets the prototype run with zero setup.
 * NOT for production — use the Supabase backend (store-supabase.ts) there.
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

interface StoreShape {
  sessions: Record<string, SessionRecord>;
}

async function readAll(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    return JSON.parse(raw) as StoreShape;
  } catch {
    return { sessions: {} };
  }
}

async function writeAll(data: StoreShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function createSession(s: SessionRecord): Promise<void> {
  const data = await readAll();
  data.sessions[s.id] = s;
  await writeAll(data);
}

export async function getSession(id: string): Promise<SessionRecord | null> {
  const data = await readAll();
  return data.sessions[id] ?? null;
}

export async function saveSession(s: SessionRecord): Promise<void> {
  const data = await readAll();
  data.sessions[s.id] = s;
  await writeAll(data);
}

export async function listSessions(): Promise<SessionRecord[]> {
  const data = await readAll();
  return Object.values(data.sessions).sort((a, b) =>
    a.startedAt < b.startedAt ? 1 : -1
  );
}

export async function deleteSession(id: string): Promise<boolean> {
  const data = await readAll();
  if (!data.sessions[id]) return false;
  delete data.sessions[id];
  await writeAll(data);
  return true;
}
