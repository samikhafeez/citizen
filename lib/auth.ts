import crypto from "crypto";

/**
 * Researcher session token (signed cookie).
 *
 * Credentials are verified in the admin API route — either via Supabase Auth
 * (production) or the ADMIN_PASSWORD fallback (dev). On success we issue this
 * short-lived signed cookie carrying the researcher's role, so the middleware
 * gate stays simple and the same mechanism works in both modes.
 */

const SECRET = process.env.ADMIN_COOKIE_SECRET || "dev-insecure-secret";

export const ADMIN_COOKIE = "cfc_admin";
export type Role = "admin" | "viewer";

export function expectedPassword(): string {
  return process.env.ADMIN_PASSWORD || "admin"; // prototype default
}

export function makeToken(role: Role = "admin"): string {
  const payload = `${role}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string | undefined): { role: Role } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  let ok = false;
  try {
    ok = crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected));
  } catch {
    ok = false;
  }
  if (!ok) return null;
  const role: Role = parts[0] === "viewer" ? "viewer" : "admin";
  return { role };
}
