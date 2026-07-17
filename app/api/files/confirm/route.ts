import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { confirmFile } from "@/server/services/fileService";
import { ServiceError } from "@/server/services/shareService";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { fileId } = body as { fileId: string };

    const file = await confirmFile(user.userId, fileId);
    return NextResponse.json({ file }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/files/confirm]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
