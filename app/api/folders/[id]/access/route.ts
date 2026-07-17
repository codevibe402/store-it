import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { ServiceError } from "@/server/services/shareService";
import { listFolderAccess } from "@/server/services/permissionService";

type RouteContext = { params: Promise<{ id: string }> };

// Who can access this folder right now — the true owner, every direct
// grant (this folder's own + inherited from ancestors, annotated with
// which folder each one lives on), and every active public link covering
// it. Owner-role only.
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const result = await listFolderAccess(user.userId, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GET /api/folders/:id/access]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
