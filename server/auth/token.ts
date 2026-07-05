import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import connectDB from '@/adapters/database/mongoose';
import RefreshToken from '@/adapters/database/models/RefreshToken';

const ACCESS_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET!;
const REFRESH_TOKEN_BYTES = 32;
const REFRESH_MAX_AGE_DAYS = 30;
const ACCESS_MAX_AGE_MINUTES = 15;

export type AccessTokenPayload = {
  userId: string;
  email: string;
  provider: string;
  storageused: number;
  storagelimit: number;
};

export type AuthUser = AccessTokenPayload;

export function generateAccessToken(user: AccessTokenPayload): string {
  return jwt.sign(
    {
      userId: user.userId,
      email: user.email,
      provider: user.provider,
      storageused: user.storageused,
      storagelimit: user.storagelimit,
    },
    ACCESS_SECRET,
    { expiresIn: `${ACCESS_MAX_AGE_MINUTES}m` }
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, ACCESS_SECRET) as jwt.JwtPayload;
    if (!decoded.userId || !decoded.email) return null;
    return {
      userId: decoded.userId as string,
      email: decoded.email as string,
      provider: (decoded.provider as string) || 'credentials',
      storageused: (decoded.storageused as number) || 0,
      storagelimit: (decoded.storagelimit as number) || 5 * 1024 * 1024 * 1024,
    };
  } catch {
    return null;
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createRefreshToken(userId: string): Promise<string> {
  await connectDB();
  const token = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
  const familyId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    userId,
    familyId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  return token;
}

export async function rotateRefreshToken(oldToken: string): Promise<{ accessToken: string; refreshToken: string; user: AuthUser } | null> {
  await connectDB();
  const tokenHash = hashToken(oldToken);
  const doc = await RefreshToken.findOne({ tokenHash });

  if (!doc || doc.expiresAt < new Date()) {
    if (doc) await RefreshToken.deleteOne({ _id: doc._id });
    return null;
  }

  const userId = doc.userId.toString();

  const { default: User } = await import('@/adapters/database/models/User');
  const user = await User.findById(userId);
  if (!user) {
    await RefreshToken.deleteOne({ _id: doc._id });
    return null;
  }

  // Delete old token
  await RefreshToken.deleteOne({ _id: doc._id });

  // Create new token (same family)
  const newToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    userId: user._id,
    familyId: doc.familyId,
    tokenHash: hashToken(newToken),
    expiresAt,
  });

  const authUser: AuthUser = {
    userId: user._id.toString(),
    email: user.email,
    provider: user.provider || 'credentials',
    storageused: user.storageused || 0,
    storagelimit: user.storagelimit || 5 * 1024 * 1024 * 1024,
  };

  const accessToken = generateAccessToken(authUser);

  return { accessToken, refreshToken: newToken, user: authUser };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await connectDB();
  const tokenHash = hashToken(token);
  await RefreshToken.deleteOne({ tokenHash });
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await connectDB();
  await RefreshToken.deleteMany({ userId });
}
