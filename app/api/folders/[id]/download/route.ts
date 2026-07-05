import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { downloadFolderAsZip } from "@/server/services/folderService";
import { ServiceError } from "@/server/services/shareService";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const { zipBuffer, folderName } = await downloadFolderAsZip(user.userId, id);

    const safeFolder = folderName.replace(/[^a-z0-9_\-. ]/gi, "_");

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeFolder}.zip"`,
        "Content-Length": String(zipBuffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GET /api/folders/:id/download]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
