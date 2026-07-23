import { NextResponse } from 'next/server';
import { generateOAuthState, getGoogleAuthUrl } from '@/server/auth/google';

export async function GET() {
  const state = generateOAuthState();
  const response = NextResponse.redirect(getGoogleAuthUrl(state));

  response.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 600,
  });

  return response;
}
