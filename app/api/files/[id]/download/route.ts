import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { getFileDownload } from "@/server/services/fileService";
import { createTelegramDownloadStream } from "@/server/lib/download";
import { ServiceError } from "@/server/services/shareService";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const versionId = req.nextUrl.searchParams.get("versionId");
    const preview = req.nextUrl.searchParams.get("preview") === "1";

    const result = await getFileDownload(user.userId, id, preview, versionId);

    if (result.kind === "stream") {
      return createTelegramDownloadStream(
        result.versionId,
        result.size,
        result.mimetype,
        result.filename,
        result.disposition,
        result.encryptionKeyBase64,
      );
    }

    const response = NextResponse.redirect(result.url, { status: 302 });
    response.headers.set('Cache-Control', 'public, max-age=86400');
    return response;
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GET /api/files/:id/download]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}