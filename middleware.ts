import { NextRequest, NextResponse } from "next/server";

// Coarse, fast, server-side gate for the authenticated app's pages —
// previously there was NO route protection anywhere (no middleware, no
// server-side check in the page components themselves), so a logged-out
// visit to e.g. /dashboard just rendered the full app shell instead of
// bouncing to /sign_in. This only checks that the access_token cookie is
// *present*, not that it's a currently-valid JWT (that requires the
// jsonwebtoken/crypto verification in server/auth/token.ts, which isn't
// worth doing at the edge here) — a present-but-expired/invalid token is
// caught by RequireAuth.tsx client-side (via /api/auth/refresh) and by
// every API route's own getAuthUser() check regardless, which remains the
// real security boundary. This is purely about not showing the page shell
// at all when there's obviously no session.
const PROTECTED_PATH_PREFIXES = ["/dashboard", "/all-files", "/folder", "/sidebar"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (!isProtected) return NextResponse.next();

  const hasAccessToken = req.cookies.has("access_token");
  if (hasAccessToken) return NextResponse.next();

  const signInUrl = new URL("/sign_in", req.url);
  signInUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/dashboard/:path*", "/all-files/:path*", "/folder/:path*", "/sidebar/:path*"],
};
