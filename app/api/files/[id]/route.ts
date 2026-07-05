import { getAuthUser } from "@/server/auth/auth";
import { NextRequest, NextResponse } from "next/server";
import { moveFile, deleteFile } from "@/server/services/fileService";
import { ServiceError } from "@/server/services/shareService";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body || !("folderId" in body)) return NextResponse.json({ error: "folderId is required" }, { status: 400 });

    const updated = await moveFile(user.userId, id, body.folderId as string | null);
    return NextResponse.json({ file: updated });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[PATCH /api/files/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const filename = await deleteFile(user.userId, id);
    return NextResponse.json({ success: true, deleted: filename });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[DELETE /api/files/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
