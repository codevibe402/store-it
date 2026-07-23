import bcrypt from 'bcryptjs';
import connectDB from '@/adapters/database/mongoose';
import User from '@/adapters/database/models/User';
import { isRateLimited, recordAttempt, resetRateLimit } from '@/server/lib/rateLimit';
import type { AuthUser } from './token';

// Same shape as credentials.ts's limits — this is a real authentication
// entry point (recovery code standing in for a password) and needs the
// same brute-force protection.
const RECOVERY_EMAIL_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };
const RECOVERY_IP_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

export type RecoveryLoginResult = {
  user: AuthUser;
  recoveryWrapped: string;
  recoveryNonce: string;
  recoverySalt: string;
};

function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export async function verifyRecoveryLogin(email: string, recoveryCode: string, ip: string): Promise<RecoveryLoginResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedCode = normalizeCode(recoveryCode);

  if (!normalizedEmail || !normalizedCode) {
    throw new Error('Invalid email or recovery code');
  }

  const emailKey = `recover:email:${normalizedEmail}`;
  const ipKey = `recover:ip:${ip}`;

  if (isRateLimited(emailKey, RECOVERY_EMAIL_LIMIT).limited || isRateLimited(ipKey, RECOVERY_IP_LIMIT).limited) {
    throw new Error('Too many attempts. Please try again later.');
  }

  try {
    await connectDB();
  } catch {
    throw new Error('Invalid email or recovery code');
  }

  // '+encryptionRecoveryCodeHash' alone (no other plain field names mixed
  // in) forces in just that select:false field on top of the normal default
  // projection — email/provider/storageused/storagelimit and the three
  // (already-selected) wrap fields all still come back. Mixing in bare
  // field names here would flip the whole query to inclusion-only and
  // silently drop everything not listed (see credentials.ts's identical
  // '+password'-alone pattern).
  const user = await User.findOne({ email: normalizedEmail }).select('+encryptionRecoveryCodeHash');

  // Generic failure for every case below — no user, no encryption ever set
  // up, or a wrong code — so this can't be used to enumerate which emails
  // have an account or have encryption configured.
  if (!user || !user.encryptionRecoveryCodeHash) {
    recordAttempt(emailKey, RECOVERY_EMAIL_LIMIT);
    recordAttempt(ipKey, RECOVERY_IP_LIMIT);
    throw new Error('Invalid email or recovery code');
  }

  const isValid = await bcrypt.compare(normalizedCode, user.encryptionRecoveryCodeHash);
  if (!isValid) {
    recordAttempt(emailKey, RECOVERY_EMAIL_LIMIT);
    recordAttempt(ipKey, RECOVERY_IP_LIMIT);
    throw new Error('Invalid email or recovery code');
  }

  resetRateLimit(emailKey);
  resetRateLimit(ipKey);

  return {
    user: {
      userId: user._id.toString(),
      email: user.email,
      provider: user.provider || 'credentials',
      storageused: user.storageused || 0,
      storagelimit: user.storagelimit || 5 * 1024 * 1024 * 1024,
    },
    recoveryWrapped: user.encryptionRecoveryWrapped,
    recoveryNonce: user.encryptionRecoveryNonce,
    recoverySalt: user.encryptionRecoverySalt,
  };
}
