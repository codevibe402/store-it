import { NextRequest, NextResponse } from "next/server";
import { ServiceError } from "@/server/services/shareService";
import { browseSharedFolder } from "@/server/services/sharedFolderService";
import { shareCookieName, verifyShareSession } from "@/server/lib/shareSession";

type RouteContext = { params: Promise<{ token: string }> };

// GET /api/shared/:token?folderId=<optional descendant folder>
// Canonical browse endpoint: lists subfolders + files at the target folder
// (share root if folderId is omitted). Every call re-resolves the link
// fresh — expiry/revocation/password state is never cached across requests.
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { token } = await params;
    const folderId = req.nextUrl.searchParams.get("folderId");
    const password = req.nextUrl.searchParams.get("password") ?? undefined;
    const sessionVerified = verifyShareSession(req.cookies.get(shareCookieName(token))?.value, token);

    const result = await browseSharedFolder(token, folderId, password, { sessionVerified });
    if (result.requiresPassword) {
      return NextResponse.json({ requiresPassword: true }, { status: 401 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GET /api/shared/:token]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
