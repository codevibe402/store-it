import { NextRequest, NextResponse } from "next/server";
import { getSharedFolderContents, createFolderInSharedFolder } from "@/server/services/shareService";
import { ServiceError } from "@/server/services/shareService";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { token } = await params;
    const result = await getSharedFolderContents(token);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GET /api/share/folder/:token/folders]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { token } = await params;
    const { name } = (await req.json()) as { name?: string };

    const folder = await createFolderInSharedFolder(token, name ?? "");
    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/share/folder/:token/folders]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
