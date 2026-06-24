import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Blocks unauthenticated access to the researcher/admin area.
// The login page itself and the admin login API stay public.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isAdminArea = pathname.startsWith("/admin");
  const isLoginPage = pathname === "/admin/login";

  if (!isAdminArea || isLoginPage) {
    return NextResponse.next();
  }

  const session = req.cookies.get("cfc_admin")?.value;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Guard the admin pages. (The /api/admin route does its own auth check.)
  matcher: ["/admin/:path*"],
};
