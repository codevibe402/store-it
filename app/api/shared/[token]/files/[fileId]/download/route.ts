import { NextRequest, NextResponse } from "next/server";
import { getSharedFileDownload } from "@/server/services/sharedFolderService";
import { createTelegramDownloadStream } from "@/server/lib/download";
import { ServiceError } from "@/server/services/shareService";
import { shareCookieName, verifyShareSession } from "@/server/lib/shareSession";

type RouteContext = { params: Promise<{ token: string; fileId: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { token, fileId } = await params;
    const password = req.nextUrl.searchParams.get("password") ?? undefined;
    const sessionVerified = verifyShareSession(req.cookies.get(shareCookieName(token))?.value, token);

    const result = await getSharedFileDownload(token, fileId, password, { sessionVerified });

    if (result.kind === "redirect") {
      return NextResponse.redirect(result.url, 302);
    }

    return createTelegramDownloadStream(
      result.versionId,
      result.size,
      result.mimetype,
      result.filename,
      "attachment",
      result.encryptionKeyBase64,
    );
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GET /api/shared/:token/files/:fileId/download]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
