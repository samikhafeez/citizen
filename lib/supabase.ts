import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase clients (created lazily so the file-store dev path never needs keys).
 *
 * - getServiceClient(): server-only, uses the SERVICE ROLE key. Bypasses RLS;
 *   use ONLY in server code (API routes, seed script). Never expose to the browser.
 * - getAnonClient(): the public anon key; subject to Row Level Security.
 */
let _service: SupabaseClient | null = null;
let _anon: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (_service) return _service;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, " +
        "or use DATA_BACKEND=file for local development."
    );
  }
  _service = createClient(url, key, { auth: { persistSession: false } });
  return _service;
}

export function getAnonClient(): SupabaseClient {
  if (_anon) return _anon;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase anon client not configured.");
  }
  _anon = createClient(url, key, { auth: { persistSession: false } });
  return _anon;
}

export function isSupabaseBackend(): boolean {
  return process.env.DATA_BACKEND === "supabase";
}
