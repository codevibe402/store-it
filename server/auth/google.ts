import crypto from 'crypto';
import connectDB from '@/adapters/database/mongoose';
import User from '@/adapters/database/models/User';
import type { AuthUser } from './token';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

export function getGoogleRedirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`;
}

export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Rejects unless both values are present and equal — never treat "both
// missing" (e.g. an expired/absent state cookie) as a match.
export function verifyOAuthState(cookieValue: string | undefined, paramValue: string | null): boolean {
  return !!cookieValue && !!paramValue && cookieValue === paramValue;
}

export function getGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: getGoogleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type GoogleUserinfo = {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
};

export async function exchangeCodeForTokens(code: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: getGoogleRedirectUri(),
    }),
  });

  if (!res.ok) {
    throw new Error('Google token exchange failed');
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Google token exchange returned no access_token');
  }
  return data.access_token as string;
}

export async function fetchGoogleUserinfo(accessToken: string): Promise<GoogleUserinfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error('Google userinfo fetch failed');
  }

  return (await res.json()) as GoogleUserinfo;
}

export async function upsertGoogleUser(info: GoogleUserinfo): Promise<AuthUser> {
  const email = info.email?.toLowerCase();
  const emailVerified = info.email_verified === true || info.email_verified === 'true';

  if (!email || !emailVerified) {
    throw new Error('Google account email not verified');
  }

  await connectDB();

  const user = await User.findOneAndUpdate(
    { email },
    { $set: { name: info.name || email, provider: 'google', providerId: info.sub } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return {
    userId: user._id.toString(),
    email: user.email,
    provider: user.provider || 'google',
    storageused: user.storageused || 0,
    storagelimit: user.storagelimit || 5 * 1024 * 1024 * 1024,
  };
}
