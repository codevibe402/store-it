import { NextRequest, NextResponse } from "next/server";
import { ServiceError } from "@/server/services/shareService";
import { uploadToSharedFolder } from "@/server/services/sharedFolderService";
import { shareCookieName, verifyShareSession } from "@/server/lib/shareSession";

type RouteContext = { params: Promise<{ token: string }> };

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value && "size" in value;
}

// POST /api/shared/:token/upload?folderId=<optional descendant folder>
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { token } = await params;
    const folderId = req.nextUrl.searchParams.get("folderId");
    const formData = await req.formData();
    const uploadedFile = formData.get("file");
    const password = (formData.get("password") as string | null) ?? undefined;

    if (!isUploadedFile(uploadedFile)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const sessionVerified = verifyShareSession(req.cookies.get(shareCookieName(token))?.value, token);
    // Re-resolved inside uploadToSharedFolder at execution time (not
    // cached from any earlier request) — a revoke or expiry that lands
    // between the client picking a file and this request completing
    // rejects the upload here, matching the "no unauthorized upload
    // should complete" requirement.
    const file = await uploadToSharedFolder(token, folderId, uploadedFile, password, { sessionVerified });
    return NextResponse.json({ file }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/shared/:token/upload]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
