import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { revokeRefreshToken } from '@/server/auth/token';
import { clearAuthCookies } from '@/server/auth/auth';

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('refresh_token')?.value;

  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }

  const response = NextResponse.json({ message: 'Logged out' });
  clearAuthCookies(response);

  return response;
}
