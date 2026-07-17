import { NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import User from "@/adapters/database/models/User";

export async function GET() {
  const user = await getAuthUser();
  if (!user?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const doc = await User.findById(user.userId)
    .select("encryptionRecoveryWrapped encryptionRecoveryNonce encryptionRecoverySalt encryptionSetupAt")
    .lean();
  if (!doc) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!doc.encryptionSetupAt) return NextResponse.json({ error: "Encryption not set up for this account" }, { status: 404 });

  return NextResponse.json({
    recoveryWrapped: doc.encryptionRecoveryWrapped,
    recoveryNonce: doc.encryptionRecoveryNonce,
    recoverySalt: doc.encryptionRecoverySalt,
  });
}
