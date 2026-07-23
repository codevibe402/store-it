import bcrypt from 'bcryptjs';
import connectDB from '@/adapters/database/mongoose';
import User from '@/adapters/database/models/User';
import { isRateLimited, recordAttempt, resetRateLimit } from '@/server/lib/rateLimit';
import type { AuthUser } from './token';

// Locks a specific account out after repeated bad passwords regardless of
// where the attempts come from (an attacker rotating IPs still hits this).
const LOGIN_EMAIL_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };
// Looser, broader net: one source hammering many different email addresses
// (credential stuffing / enumeration) rather than one account.
const LOGIN_IP_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

export async function verifyCredentials(email: string, password: string, ip: string): Promise<AuthUser> {
  const normalizedEmail = email.toLowerCase().trim();

  if (!normalizedEmail || password.length < 6) {
    throw new Error('Invalid credentials');
  }

  const emailKey = `login:email:${normalizedEmail}`;
  const ipKey = `login:ip:${ip}`;

  // Checked (not consumed) up front, before touching the DB or spending a
  // bcrypt compare on an already-locked-out target.
  if (isRateLimited(emailKey, LOGIN_EMAIL_LIMIT).limited || isRateLimited(ipKey, LOGIN_IP_LIMIT).limited) {
    throw new Error('Too many login attempts. Please try again later.');
  }

  try {
    await connectDB();
  } catch {
    throw new Error('Invalid credentials');
  }

  const user = await User.findOne({ email: normalizedEmail }).select('+password');
  if (!user) {
    recordAttempt(emailKey, LOGIN_EMAIL_LIMIT);
    recordAttempt(ipKey, LOGIN_IP_LIMIT);
    throw new Error('Invalid credentials');
  }

  if (user.provider !== 'credentials' || !user.password) {
    recordAttempt(emailKey, LOGIN_EMAIL_LIMIT);
    recordAttempt(ipKey, LOGIN_IP_LIMIT);
    throw new Error('Invalid credentials');
  }

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    recordAttempt(emailKey, LOGIN_EMAIL_LIMIT);
    recordAttempt(ipKey, LOGIN_IP_LIMIT);
    throw new Error('Invalid credentials');
  }

  resetRateLimit(emailKey);
  resetRateLimit(ipKey);

  return {
    userId: user._id.toString(),
    email: user.email,
    provider: user.provider || 'credentials',
    storageused: user.storageused || 0,
    storagelimit: user.storagelimit || 5 * 1024 * 1024 * 1024,
  };
}
