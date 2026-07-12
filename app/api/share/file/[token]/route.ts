import { NextRequest, NextResponse } from "next/server";
import { getSharedFileByToken } from "@/server/services/shareService";
import { createTelegramDownloadStream } from "@/server/lib/download";
import { ServiceError } from "@/server/services/shareService";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const versionId = req.nextUrl.searchParams.get("versionId");
    const download = req.nextUrl.searchParams.get("download") === "1";

    const result = await getSharedFileByToken(token, versionId);

    if (result.kind === "redirect") {
      return NextResponse.redirect(result.url, 302);
    }

    return createTelegramDownloadStream(
      result.versionId,
      result.size,
      result.mimetype,
      result.filename,
      download ? "attachment" : "inline",
      result.encryptionKeyBase64,
    );
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GET /api/share/file/:token]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
