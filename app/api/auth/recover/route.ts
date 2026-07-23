import { NextRequest, NextResponse } from 'next/server';
import { verifyRecoveryLogin } from '@/server/auth/recovery';
import { issueSession } from '@/server/auth/auth';
import { getClientIp } from '@/server/lib/rateLimit';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (typeof body?.email !== 'string' || typeof body?.recoveryCode !== 'string') {
    return NextResponse.json({ error: 'Invalid email or recovery code' }, { status: 401 });
  }

  const ip = getClientIp(req.headers);

  try {
    const { user, recoveryWrapped, recoveryNonce, recoverySalt } = await verifyRecoveryLogin(body.email, body.recoveryCode, ip);
    const response = NextResponse.json({ user, recoveryWrapped, recoveryNonce, recoverySalt });
    await issueSession(response, user);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid email or recovery code';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
