import Link from "next/link";

// Researcher/admin area. Access is enforced by middleware.ts (redirects to
// /admin/login when no valid session cookie is present). In production this is
// replaced by Supabase Auth with role-based access (admin vs viewer).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-wrap" dir="ltr">
      <div className="admin-nav">
        <strong style={{ color: "var(--navy)" }}>Researcher dashboard</strong>
        <span style={{ flex: 1 }} />
        <Link href="/admin">Overview</Link>
        <Link href="/admin/responses">Responses</Link>
        <Link href="/admin/rag">RAG query</Link>
        <a href="/assistant" target="_blank" rel="noopener" title="Opens the general assistant (no participant data)">
          Assistant ↗
        </a>
      </div>
      {children}
    </div>
  );
}
