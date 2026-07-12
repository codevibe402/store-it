import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { getRecycleBinFiles, restoreFile, hardDeleteFile } from "@/server/services/fileService";
import { ServiceError } from "@/server/services/shareService";

export async function GET(req: NextRequest, { params }: { params: Promise<{ ownerId: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { ownerId } = await params;
    if (ownerId !== user.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const files = await getRecycleBinFiles(user.userId);
    return NextResponse.json({ files });
  } catch (err) {
    console.error("[GET /api/recycle/:ownerId]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ ownerId: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { ownerId } = await params;
    if (ownerId !== user.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => null);
    if (!body?.fileId) return NextResponse.json({ error: "fileId is required" }, { status: 400 });

    const file = await restoreFile(user.userId, body.fileId);
    return NextResponse.json({ file });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/recycle/:ownerId]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ ownerId: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { ownerId } = await params;
    if (ownerId !== user.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => null);
    if (!body?.fileId) return NextResponse.json({ error: "fileId is required" }, { status: 400 });

    const filename = await hardDeleteFile(user.userId, body.fileId);
    return NextResponse.json({ success: true, deleted: filename });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[DELETE /api/recycle/:ownerId]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}