import { NextRequest, NextResponse } from 'next/server';
import {
  verifyOAuthState,
  exchangeCodeForTokens,
  fetchGoogleUserinfo,
  upsertGoogleUser,
} from '@/server/auth/google';
import { issueSession } from '@/server/auth/auth';

function redirectToSignIn(req: NextRequest, error: string) {
  const url = new URL('/sign_in', req.url);
  url.searchParams.set('error', error);
  const response = NextResponse.redirect(url);
  response.cookies.set('google_oauth_state', '', { path: '/api/auth', maxAge: 0 });
  return response;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // User denied consent (or Google reported some other error) — check this
  // before touching state at all, since Google's error redirect often omits
  // `code`/`state` entirely.
  if (searchParams.get('error')) {
    return redirectToSignIn(req, 'oauth_denied');
  }

  const state = searchParams.get('state');
  const cookieState = req.cookies.get('google_oauth_state')?.value;
  if (!verifyOAuthState(cookieState, state)) {
    return redirectToSignIn(req, 'oauth_state');
  }

  const code = searchParams.get('code');
  if (!code) {
    return redirectToSignIn(req, 'oauth_failed');
  }

  try {
    const accessToken = await exchangeCodeForTokens(code);
    const userinfo = await fetchGoogleUserinfo(accessToken);
    const user = await upsertGoogleUser(userinfo);

    const response = NextResponse.redirect(new URL('/dashboard', req.url));
    response.cookies.set('google_oauth_state', '', { path: '/api/auth', maxAge: 0 });
    await issueSession(response, user);
    return response;
  } catch {
    return redirectToSignIn(req, 'oauth_failed');
  }
}
