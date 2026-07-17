import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { getFileManifest } from "@/server/services/fileService";
import { ServiceError } from "@/server/services/shareService";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const versionId = req.nextUrl.searchParams.get("versionId");

    const manifest = await getFileManifest(user.userId, id, versionId);
    const response = NextResponse.json(manifest);
    // Chunk list + nonces for a given (file, version) never change once
    // uploaded — a new version gets a new versionId, so this stays correct.
    response.headers.set("Cache-Control", "private, max-age=86400, immutable");
    return response;
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GET /api/files/:id/manifest]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
