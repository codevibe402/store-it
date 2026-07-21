import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { restoreVersion } from "@/server/services/versioningService";
import { ServiceError } from "@/server/services/shareService";

type RouteContext = {
  params: Promise<{ id: string; versionId: string }>;
};

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, versionId } = await params;
    const result = await restoreVersion(user.userId, id, versionId);

    return NextResponse.json({
      file: result.file,
      version: result.version,
      versionId: result.versionId,
    });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/files/:id/versions/:versionId/restore]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
