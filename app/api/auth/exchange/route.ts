import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth/config';
import connectDB from '@/adapters/database/mongoose';
import User from '@/adapters/database/models/User';
import { generateAccessToken, createRefreshToken } from '@/server/auth/token';
import { setAuthCookies, type AuthUser } from '@/server/auth/auth';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectDB();

  const user = await User.findOne({ email: session.user.email });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 401 });
  }

  const authUser: AuthUser = {
    userId: user._id.toString(),
    email: user.email,
    provider: user.provider || 'credentials',
    storageused: user.storageused || 0,
    storagelimit: user.storagelimit || 5 * 1024 * 1024 * 1024,
  };

  const accessToken = generateAccessToken(authUser);
  const refreshToken = await createRefreshToken(authUser.userId);

  const response = NextResponse.json({ user: authUser });
  setAuthCookies(response, accessToken, refreshToken);

  return response;
}
