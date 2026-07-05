import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import Folder from "@/adapters/database/models/Folder";
import Permission from "@/adapters/database/models/Permission";
import User from "@/adapters/database/models/User";

const PERMISSIONS = ["read", "write", "admin"] as const;
const RESOURCE_TYPES = ["file", "folder"] as const;

type PermissionLevel = (typeof PERMISSIONS)[number];
type ResourceType = (typeof RESOURCE_TYPES)[number];

type ShareBody = {
  resourceId?: string;
  resourceType?: ResourceType;
  permission?: PermissionLevel;
  sharedWithEmail?: string;
  sharedWithUserId?: string;
};

type LeanResource = {
  owner_id?: { toString(): string } | string;
};

type LeanUser = {
  _id: { toString(): string };
};

type LeanPermission = {
  _id: { toString(): string };
};

async function getCurrentUserId() {
  const user = await getAuthUser();

  if (!user?.userId) {
    const error = new Error("Unauthorized") as Error & { status?: number };
    error.status = 401;
    throw error;
  }

  return user.userId;
}

function isObjectId(value: unknown): value is string {
  return typeof value === "string" && mongoose.Types.ObjectId.isValid(value);
}

function isPermission(value: unknown): value is PermissionLevel {
  return typeof value === "string" && PERMISSIONS.includes(value as PermissionLevel);
}

function isResourceType(value: unknown): value is ResourceType {
  return typeof value === "string" && RESOURCE_TYPES.includes(value as ResourceType);
}

async function findResource(resourceType: ResourceType, resourceId: string) {
  const Model = resourceType === "file" ? File : Folder;
  return Model.findById(resourceId).lean();
}

async function canManageResource(
  userId: string,
  resourceType: ResourceType,
  resourceId: string
) {
  const resource = await findResource(resourceType, resourceId);

  if (!resource) {
    return { allowed: false, missing: true };
  }

  if ((resource as LeanResource).owner_id?.toString() === userId) {
    return { allowed: true, missing: false };
  }

  const adminPermission = await Permission.exists({
    sharedwith: userId,
    resource_id: resourceId,
    resource_type: resourceType,
    permission: "admin",
  });

  return { allowed: Boolean(adminPermission), missing: false };
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

// POST /api/share/permissions
// Body:
// {
//   "resourceId": "...",
//   "resourceType": "file" | "folder",
//   "sharedWithEmail": "friend@example.com", // or sharedWithUserId
//   "permission": "read" | "write" | "admin"
// }
export async function POST(req: NextRequest) {
  try {
    const currentUserId = await getCurrentUserId();
    const body = (await req.json()) as ShareBody;

    if (!isObjectId(body.resourceId)) {
      return badRequest("Valid resourceId is required");
    }

    if (!isResourceType(body.resourceType)) {
      return badRequest("resourceType must be file or folder");
    }

    if (!isPermission(body.permission)) {
      return badRequest("permission must be read, write, or admin");
    }

    if (!body.sharedWithEmail && !body.sharedWithUserId) {
      return badRequest("sharedWithEmail or sharedWithUserId is required");
    }

    await connectDB();

    const access = await canManageResource(
      currentUserId,
      body.resourceType,
      body.resourceId
    );

    if (access.missing) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sharedWithUser = body.sharedWithUserId
      ? await User.findById(body.sharedWithUserId).lean()
      : await User.findOne({ email: body.sharedWithEmail?.toLowerCase().trim() }).lean();

    if (!sharedWithUser) {
      return NextResponse.json({ error: "User to share with not found" }, { status: 404 });
    }

    const sharedWithId = (sharedWithUser as LeanUser)._id.toString();

    if (sharedWithId === currentUserId) {
      return badRequest("You cannot share a resource with yourself");
    }

    const permission = await Permission.findOneAndUpdate(
      {
        sharedwith: sharedWithId,
        resource_id: body.resourceId,
        resource_type: body.resourceType,
      },
      {
        $set: {
          sharedwith: sharedWithId,
          resource_id: body.resourceId,
          resource_type: body.resourceType,
          permission: body.permission,
        },
      },
      { new: true, upsert: true, runValidators: true }
    ).lean();

    return NextResponse.json(
      {
        message: "Permission saved",
        permission: {
          id: (permission as LeanPermission)._id.toString(),
          sharedwith: sharedWithId,
          resource_id: body.resourceId,
          resource_type: body.resourceType,
          permission: body.permission,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[POST /api/share/permissions]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/share/permissions?resourceId=...&resourceType=file|folder
export async function GET(req: NextRequest) {
  try {
    const currentUserId = await getCurrentUserId();
    const resourceId = req.nextUrl.searchParams.get("resourceId");
    const resourceType = req.nextUrl.searchParams.get("resourceType");

    if (!isObjectId(resourceId)) {
      return badRequest("Valid resourceId is required");
    }

    if (!isResourceType(resourceType)) {
      return badRequest("resourceType must be file or folder");
    }

    await connectDB();

    const access = await canManageResource(currentUserId, resourceType, resourceId);

    if (access.missing) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const permissions = await Permission.find({
      resource_id: resourceId,
      resource_type: resourceType,
    })
      .populate("sharedwith", "name email")
      .sort({ updatedAt: -1 })
      .lean();

    return NextResponse.json({ permissions });
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[GET /api/share/permissions]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/share/permissions
// Body: { "resourceId": "...", "resourceType": "file" | "folder", "sharedWithUserId": "..." }
export async function DELETE(req: NextRequest) {
  try {
    const currentUserId = await getCurrentUserId();
    const body = (await req.json()) as ShareBody;

    if (!isObjectId(body.resourceId)) {
      return badRequest("Valid resourceId is required");
    }

    if (!isResourceType(body.resourceType)) {
      return badRequest("resourceType must be file or folder");
    }

    if (!isObjectId(body.sharedWithUserId)) {
      return badRequest("Valid sharedWithUserId is required");
    }

    await connectDB();

    const access = await canManageResource(
      currentUserId,
      body.resourceType,
      body.resourceId
    );

    if (access.missing) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await Permission.deleteOne({
      sharedwith: body.sharedWithUserId,
      resource_id: body.resourceId,
      resource_type: body.resourceType,
    });

    return NextResponse.json({
      success: true,
      revoked: result.deletedCount,
    });
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[DELETE /api/share/permissions]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
