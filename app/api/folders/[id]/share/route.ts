import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { createFolderShare, getFolderShare, revokeFolderShares } from "@/server/services/shareService";
import { ServiceError } from "@/server/services/shareService";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { permission?: string; expiresInDays?: number };

    const result = await createFolderShare(user.userId, id, body.permission ?? "read", body.expiresInDays ?? 7);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/folders/:id/share]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const result = await getFolderShare(user.userId, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GET /api/folders/:id/share]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const result = await revokeFolderShares(user.userId, id);
    return NextResponse.json({ success: true, revoked: result.deletedCount });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[DELETE /api/folders/:id/share]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
