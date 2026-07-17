import { NextRequest, NextResponse } from "next/server";
import { ServiceError } from "@/server/services/shareService";
import { createFolderInSharedFolder } from "@/server/services/sharedFolderService";
import { shareCookieName, verifyShareSession } from "@/server/lib/shareSession";

type RouteContext = { params: Promise<{ token: string }> };

// POST /api/shared/:token/folders?folderId=<optional descendant folder>
// Creates a subfolder at the target folder (share root if folderId is
// omitted). Editor-role links only, re-validated at execution time.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { token } = await params;
    const folderId = req.nextUrl.searchParams.get("folderId");
    const body = (await req.json().catch(() => ({}))) as { name?: string; password?: string };
    const sessionVerified = verifyShareSession(req.cookies.get(shareCookieName(token))?.value, token);

    const folder = await createFolderInSharedFolder(token, folderId, body.name ?? "", body.password, { sessionVerified });
    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/shared/:token/folders]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
