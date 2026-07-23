import { NextRequest, NextResponse } from 'next/server';
import { verifyCredentials } from '@/server/auth/credentials';
import { issueSession } from '@/server/auth/auth';
import { getClientIp } from '@/server/lib/rateLimit';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (typeof body?.email !== 'string' || typeof body?.password !== 'string') {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const ip = getClientIp(req.headers);

  try {
    const user = await verifyCredentials(body.email, body.password, ip);
    const response = NextResponse.json({ user });
    await issueSession(response, user);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid credentials';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
