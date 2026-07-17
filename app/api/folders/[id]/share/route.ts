import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { ServiceError } from "@/server/services/shareService";
import {
  createShareLink,
  updateShareLink,
  revokeShareLink,
  grantUserPermission,
  unshareUserPermission,
  revokeUserPermission,
  type FolderRole,
} from "@/server/services/permissionService";
import { withIdempotency, IdempotentReplay } from "@/server/lib/idempotency";

type RouteContext = { params: Promise<{ id: string }> };

const ROLES: FolderRole[] = ["viewer", "editor", "owner"];
const LINK_ROLES: FolderRole[] = ["viewer", "editor"];

// POST creates a share — a direct grant to a specific user (`type:"user"`)
// or a public link (`type:"link"`). `type` and `role` are both required —
// there is no implicit default, the caller states its intent.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      type?: "link" | "user";
      role?: FolderRole;
      expiresInDays?: number;
      password?: string;
      maxUses?: number;
      email?: string;
      userId?: string;
    };

    const idempotencyKey = req.headers.get("Idempotency-Key");

    try {
      if (body.type === "user") {
        if (!body.role || !ROLES.includes(body.role)) {
          return NextResponse.json({ error: "role must be viewer, editor, or owner" }, { status: 400 });
        }
        const { status, body: respBody } = await withIdempotency("folder-share-user", idempotencyKey, async () => {
          const result = await grantUserPermission(user.userId, id, body.role as FolderRole, { email: body.email, userId: body.userId });
          return { status: 201, body: { type: "user" as const, ...result } };
        });
        return NextResponse.json(respBody, { status });
      }

      if (body.type === "link") {
        if (!body.role || !LINK_ROLES.includes(body.role)) {
          return NextResponse.json({ error: "role must be viewer or editor" }, { status: 400 });
        }
        const { status, body: respBody } = await withIdempotency("folder-share-link", idempotencyKey, async () => {
          const result = await createShareLink(user.userId, id, {
            role: body.role as "viewer" | "editor",
            expiresInDays: body.expiresInDays,
            password: body.password,
            maxUses: body.maxUses,
          });
          return { status: 201, body: { type: "link" as const, ...result } };
        });
        return NextResponse.json(respBody, { status });
      }

      return NextResponse.json({ error: 'type must be "user" or "link"' }, { status: 400 });
    } catch (err) {
      if (err instanceof IdempotentReplay) return NextResponse.json(err.body, { status: err.status });
      throw err;
    }
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/folders/:id/share]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH updates an existing link's role/expiry/password.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      linkId?: string;
      role?: "viewer" | "editor";
      expiresInDays?: number;
      password?: string | null;
    };
    if (!body.linkId) return NextResponse.json({ error: "linkId is required" }, { status: 400 });

    const result = await updateShareLink(user.userId, id, body.linkId, {
      role: body.role,
      expiresInDays: body.expiresInDays,
      password: body.password,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[PATCH /api/folders/:id/share]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE revokes a share. `{linkId}` -> revoke just that link. `{userId}`
// -> stop a direct share; add `{userId, deny:true}` to leave an explicit
// deny in place instead of just removing the grant. No body -> revoke
// every link on this folder.
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { linkId?: string; userId?: string; deny?: boolean };

    if (body.userId) {
      const result = body.deny
        ? await revokeUserPermission(user.userId, id, body.userId)
        : await unshareUserPermission(user.userId, id, body.userId);
      return NextResponse.json({ success: true, result });
    }

    const result = await revokeShareLink(user.userId, id, body.linkId);
    return NextResponse.json({ success: true, revoked: result.modifiedCount });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[DELETE /api/folders/:id/share]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
