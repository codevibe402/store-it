import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { shareFileWithUser, getFilePermissions, revokeFilePermission, ServiceError } from "@/server/services/shareService";

// File-only direct permission sharing. Folder sharing has its own engine —
// see /api/folders/:id/share and /api/folders/:id/access.
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    if (body.resourceType && body.resourceType !== "file") {
      return NextResponse.json({ error: "Folder sharing has moved to /api/folders/:id/share" }, { status: 400 });
    }

    const permission = await shareFileWithUser(
      user.userId,
      body.resourceId,
      body.permission,
      body.sharedWithEmail,
      body.sharedWithUserId,
    );

    return NextResponse.json(
      { message: "Permission saved", permission: { id: permission._id.toString(), sharedwith: permission.sharedwith, resource_id: permission.resource_id, resource_type: permission.resource_type, permission: permission.permission } },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/share/permissions]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const resourceId = req.nextUrl.searchParams.get("resourceId");
    const resourceType = req.nextUrl.searchParams.get("resourceType");

    if (!resourceId) {
      return NextResponse.json({ error: "resourceId is required" }, { status: 400 });
    }
    if (resourceType && resourceType !== "file") {
      return NextResponse.json({ error: "Folder access has moved to /api/folders/:id/access" }, { status: 400 });
    }

    const permissions = await getFilePermissions(user.userId, resourceId);
    return NextResponse.json({ permissions });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GET /api/share/permissions]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    if (body.resourceType && body.resourceType !== "file") {
      return NextResponse.json({ error: "Folder sharing has moved to /api/folders/:id/share" }, { status: 400 });
    }
    const result = await revokeFilePermission(user.userId, body.resourceId, body.sharedWithUserId);

    return NextResponse.json({ success: true, revoked: result.deletedCount });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[DELETE /api/share/permissions]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
