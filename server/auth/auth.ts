import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAccessToken, generateAccessToken, createRefreshToken, type AuthUser } from '@/server/auth/token';

export type { AuthUser };

// Mints a fresh access/refresh token pair for a just-authenticated user and
// sets both cookies on the response. The single call site every login route
// (credentials, telegram, google) goes through, so cookie-setting can't
// drift between them.
export async function issueSession(res: NextResponse, user: AuthUser): Promise<void> {
  const accessToken = generateAccessToken(user);
  const refreshToken = await createRefreshToken(user.userId);
  setAuthCookies(res, accessToken, refreshToken);
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

export type AuthErrorResponse = NextResponse & { isAuthError: true };

export async function requireAuth(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) {
    throw createAuthError();
  }
  return user;
}

export function createAuthError(): AuthErrorResponse {
  const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as AuthErrorResponse;
  res.isAuthError = true;
  return res;
}

const ACCESS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  // Must be readable on page navigations (e.g. /dashboard), not just
  // /api/*: middleware.ts checks for this cookie's presence to gate
  // protected pages, and a browser never attaches a cookie to a request
  // outside its Path scope. Scoping this to '/api' would make middleware's
  // check always see "logged out" on real page loads.
  path: '/',
  maxAge: 15 * 60,
};

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: 30 * 24 * 60 * 60,
};

export function setAuthCookies(res: NextResponse, accessToken: string, refreshToken: string) {
  res.cookies.set('access_token', accessToken, ACCESS_COOKIE_OPTIONS);
  res.cookies.set('refresh_token', refreshToken, REFRESH_COOKIE_OPTIONS);
  return res;
}

export function clearAuthCookies(res: NextResponse) {
  res.cookies.set('access_token', '', { ...ACCESS_COOKIE_OPTIONS, maxAge: 0 });
  res.cookies.set('refresh_token', '', { ...REFRESH_COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
