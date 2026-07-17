import { NextRequest, NextResponse } from "next/server";
import { ServiceError } from "@/server/services/shareService";
import { resolveShareLink } from "@/server/services/permissionService";
import { shareCookieName, signShareSession } from "@/server/lib/shareSession";

type RouteContext = { params: Promise<{ token: string }> };

// POST /api/shared/:token/access — submit a password for a
// password-protected link. On success, mints a short-lived HttpOnly
// session cookie scoped to this exact token so the browser doesn't have to
// resend the password on every subsequent browse/upload/download call.
// Wrong-password attempts are rate-limited inside resolveShareLink
// (per-link lockout), not here, so this route stays a thin wrapper.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { token } = await params;
    const body = (await req.json().catch(() => ({}))) as { password?: string };
    if (!body.password) return NextResponse.json({ error: "password is required" }, { status: 400 });

    const access = await resolveShareLink(token, body.password);
    if (access.requiresPassword) {
      // Unreachable in practice — resolveShareLink only returns
      // requiresPassword:true when no password was supplied at all.
      return NextResponse.json({ requiresPassword: true }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true, role: access.role, folderId: access.folderId });
    res.cookies.set(shareCookieName(token), signShareSession(token), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      // Scoped to all of /api (not just /api/shared/:token) so it also
      // covers the SSR page's server-side fetch to the browse endpoint.
      path: "/api",
      maxAge: 2 * 60 * 60,
    });
    return res;
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/shared/:token/access]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
