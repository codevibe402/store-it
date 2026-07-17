import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import User from "@/adapters/database/models/User";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const { recoveryWrapped, recoveryNonce, recoverySalt } = body as {
    recoveryWrapped?: string;
    recoveryNonce?: string;
    recoverySalt?: string;
  } ?? {};

  if (!recoveryWrapped || !recoveryNonce || !recoverySalt) {
    return NextResponse.json({ error: "recoveryWrapped, recoveryNonce, and recoverySalt are required" }, { status: 400 });
  }

  await connectDB();

  const doc = await User.findById(user.userId).select("encryptionSetupAt");
  if (!doc) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // One-time setup: once a DEK exists, overwriting it here would orphan
  // every file already encrypted under the old key. Recovery/re-wrapping
  // after that point must go through a dedicated re-wrap flow instead.
  if (doc.encryptionSetupAt) {
    return NextResponse.json({ error: "Encryption already set up for this account" }, { status: 409 });
  }

  doc.encryptionRecoveryWrapped = recoveryWrapped;
  doc.encryptionRecoveryNonce = recoveryNonce;
  doc.encryptionRecoverySalt = recoverySalt;
  doc.encryptionSetupAt = new Date();
  await doc.save();

  return NextResponse.json({ success: true });
}
