import { NextRequest, NextResponse } from "next/server";
import { getSharedFileDownload } from "@/server/services/shareService";
import { createTelegramDownloadStream } from "@/server/lib/download";
import { ServiceError } from "@/server/services/shareService";

type RouteContext = { params: Promise<{ token: string; fileId: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { token, fileId } = await params;
    const versionId = req.nextUrl.searchParams.get("versionId");

    const result = await getSharedFileDownload(token, fileId);

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
    console.error("[GET /api/share/folder/:token/files/:fileId/download]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}