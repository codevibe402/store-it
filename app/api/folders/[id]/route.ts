import { NextRequest, NextResponse, after } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { ServiceError } from "@/server/services/shareService";
import {
  softDeleteFolderFast,
  cascadeDeleteFolderContents,
  renameFolder,
  moveFolder,
  resolveFolderPermission,
} from "@/server/services/folderService";
import connectDB from "@/adapters/database/mongoose";
import Folder from "@/adapters/database/models/Folder";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    await connectDB();

    const access = await resolveFolderPermission(user.userId, id);
    if (!access) return NextResponse.json({ error: "Folder not found" }, { status: 404 });

    const folder = await Folder.findOne({ _id: id, deleted: { $ne: true } }).lean();
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });

    return NextResponse.json({ folder, access: { role: access.role, source: access.source } });
  } catch (err) {
    console.error("[GET /api/folders/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const body = await req.json();

    // Rename and move are distinct operations with distinct safety
    // properties (move needs a transaction + cycle check; rename doesn't),
    // so they're never merged into one blind $set the way the old handler
    // did it.
    let folder;
    if (body.parentId !== undefined) {
      folder = await moveFolder(user.userId, id, body.parentId);
    }
    if (body.name !== undefined) {
      folder = await renameFolder(user.userId, id, body.name);
    }

    if (!folder) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    return NextResponse.json({ folder });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[PATCH /api/folders/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;

    // Fast path: hide the folder from the UI immediately (permission
    // re-validated inside softDeleteFolderFast at execution time).
    try {
      await softDeleteFolderFast(user.userId, id);
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }

    // Background path: cascade to descendant folders and move every
    // contained file into the recycle bin. Scheduled via `after()` so it
    // keeps running past this response on serverless (Vercel), without
    // making the caller wait for it. No further permission check needed —
    // the fast path above already authorized deleting this exact subtree,
    // and the cascade only ever touches folderId's own descendants.
    after(() => cascadeDeleteFolderContents(id).catch((err) => {
      console.error("[DELETE /api/folders/:id] background cascade failed", err);
    }));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/folders/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
