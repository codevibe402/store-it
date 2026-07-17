import { NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import User from "@/adapters/database/models/User";

export async function GET() {
  const user = await getAuthUser();
  if (!user?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const doc = await User.findById(user.userId).select("encryptionSetupAt").lean();
  if (!doc) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({ hasEncryption: !!doc.encryptionSetupAt });
}
