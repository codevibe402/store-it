import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegramLogin } from '@/server/auth/telegram';
import { issueSession } from '@/server/auth/auth';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  try {
    const user = await verifyTelegramLogin(body ?? {});
    const response = NextResponse.json({ user });
    await issueSession(response, user);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid Telegram auth';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
