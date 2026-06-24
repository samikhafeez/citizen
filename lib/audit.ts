import { isSupabaseBackend, getServiceClient } from "./supabase";

/**
 * Append-only audit trail for researcher actions (login, export, delete, query).
 *
 * - Supabase backend: inserts a row into `audit_logs`.
 * - File backend (dev): logs to the server console (no participant data involved).
 *
 * Best-effort: auditing must never block or break the action it records, so all
 * errors are swallowed. `detail` should never contain personal participant data
 * — record identifiers (session id, row counts), not free-text answers.
 */
export type AuditAction = "login" | "login_failed" | "export" | "delete" | "rag_query" | "rag_sync";

export async function logAudit(action: AuditAction, detail?: string, actor?: string): Promise<void> {
  const line = `[audit] ${new Date().toISOString()} ${action}${actor ? ` by ${actor}` : ""}${detail ? ` — ${detail}` : ""}`;
  if (!isSupabaseBackend()) {
    // Dev/file backend: there is no audit_logs table to write to.
    console.log(line);
    return;
  }
  try {
    await getServiceClient().from("audit_logs").insert({
      action,
      detail: [actor ? `actor=${actor}` : null, detail].filter(Boolean).join("; ") || null,
    });
  } catch {
    console.warn("audit write failed:", line);
  }
}

/**
 * Record a CSV export in the `exports` table (Supabase only). Mirrors the
 * data model (Section 4.7): which filters were used and how many rows left.
 */
export async function logExport(filters: Record<string, string>, rowCount: number): Promise<void> {
  if (!isSupabaseBackend()) {
    console.log(`[export] rows=${rowCount} filters=${JSON.stringify(filters)}`);
    return;
  }
  try {
    await getServiceClient().from("exports").insert({ filters, row_count: rowCount });
  } catch {
    console.warn("export-log write failed");
  }
}
