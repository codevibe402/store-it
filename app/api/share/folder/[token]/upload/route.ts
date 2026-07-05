import { NextRequest, NextResponse } from "next/server";
import { uploadToSharedFolder } from "@/server/services/shareService";
import { ServiceError } from "@/server/services/shareService";

type RouteContext = { params: Promise<{ token: string }> };

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value && "size" in value;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { token } = await params;
    const formData = await req.formData();
    const uploadedFile = formData.get("file");

    if (!isUploadedFile(uploadedFile)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const file = await uploadToSharedFolder(token, uploadedFile);
    return NextResponse.json({ file }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/share/folder/:token/upload]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
