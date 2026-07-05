import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { rotateRefreshToken } from '@/server/auth/token';
import { setAuthCookies } from '@/server/auth/auth';

export async function POST() {
  const cookieStore = await cookies();
  const oldRefreshToken = cookieStore.get('refresh_token')?.value;

  if (!oldRefreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  const result = await rotateRefreshToken(oldRefreshToken);
  if (!result) {
    return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
  }

  const { accessToken, refreshToken, user } = result;

  const response = NextResponse.json({ user });
  setAuthCookies(response, accessToken, refreshToken);

  return response;
}
