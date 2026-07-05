import { getAuthUser } from "@/server/auth/auth";
import { NextRequest, NextResponse } from "next/server";
import { moveFolder, deleteFolder } from "@/server/services/folderService";
import { ServiceError } from "@/server/services/shareService";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body || !("parentId" in body)) return NextResponse.json({ error: "parentId is required" }, { status: 400 });

    const updated = await moveFolder(user.userId, id, body.parentId as string | null);
    return NextResponse.json({ folder: updated });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[PATCH /api/folders/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const deleteFiles = req.nextUrl.searchParams.get("deleteFiles") === "true";

    const result = await deleteFolder(user.userId, id, deleteFiles);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[DELETE /api/folders/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
