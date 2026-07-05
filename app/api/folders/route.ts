import { getAuthUser } from "@/server/auth/auth";
import { NextRequest, NextResponse } from "next/server";
import { getFolders, createFolder } from "@/server/services/folderService";
import { ServiceError } from "@/server/services/shareService";

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const folders = await getFolders(user.email!);
    const response = NextResponse.json(folders);
    response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    return response;
  } catch (err) {
    console.error("[GET /api/folders]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { name, parent_id } = await req.json();
    const folder = await createFolder(user.userId!, user.email!, name, parent_id);
    return NextResponse.json(folder, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/folders]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
