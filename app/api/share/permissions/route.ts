import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { shareWithUser, getResourcePermissions, revokeUserPermission, ServiceError } from "@/server/services/shareService";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const permission = await shareWithUser(
      user.userId,
      body.resourceId,
      body.resourceType,
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

    if (!resourceId || !resourceType) {
      return NextResponse.json({ error: "resourceId and resourceType are required" }, { status: 400 });
    }

    const permissions = await getResourcePermissions(user.userId, resourceId, resourceType as "file" | "folder");
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
    const result = await revokeUserPermission(user.userId, body.resourceId, body.resourceType, body.sharedWithUserId);

    return NextResponse.json({ success: true, revoked: result.deletedCount });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[DELETE /api/share/permissions]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
