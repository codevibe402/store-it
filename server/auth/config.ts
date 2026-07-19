import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import connectDB from '@/adapters/database/mongoose';
import User from '@/adapters/database/models/User';
import NextAuth, { NextAuthOptions } from 'next-auth';
import { isRateLimited, recordAttempt, resetRateLimit, getClientIp } from '@/server/lib/rateLimit';

// Locks a specific account out after repeated bad passwords regardless of
// where the attempts come from (an attacker rotating IPs still hits this).
const LOGIN_EMAIL_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };
// Looser, broader net: one source hammering many different email addresses
// (credential stuffing / enumeration) rather than one account.
const LOGIN_IP_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

type AppAuthUser = {
  storageused?: number;
  storagelimit?: number;
};

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

export const authOptions: NextAuthOptions = {
  providers: [
    // ── Google OAuth ──────────────────────────────────────────────
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: 'select_account',
        },
      },
    }),

    // ── Telegram Login ───────────────────────────────────────────
    CredentialsProvider({
      id: 'telegram',
      name: 'Telegram',
      credentials: {
        id: { label: 'Telegram ID', type: 'text' },
        first_name: { label: 'First Name', type: 'text' },
        last_name: { label: 'Last Name', type: 'text' },
        username: { label: 'Username', type: 'text' },
        photo_url: { label: 'Photo URL', type: 'text' },
        auth_date: { label: 'Auth Date', type: 'text' },
        hash: { label: 'Hash', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.id || !credentials?.hash) {
          throw new Error('Missing Telegram auth data');
        }

        // Verify Telegram hash
        const secret = crypto
          .createHash('sha256')
          .update(TELEGRAM_BOT_TOKEN)
          .digest();

        const dataCheckString = Object.entries({
          auth_date: credentials.auth_date,
          first_name: credentials.first_name,
          id: credentials.id,
          last_name: credentials.last_name,
          photo_url: credentials.photo_url,
          username: credentials.username,
        })
          .filter(([, v]) => v !== undefined && v !== '')
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join('\n');

        const computedHash = crypto
          .createHmac('sha256', secret)
          .update(dataCheckString)
          .digest('hex');

        if (computedHash !== credentials.hash) {
          throw new Error('Invalid Telegram auth');
        }

        // Check auth_date is within 24 hours
        const authDate = parseInt(credentials.auth_date, 10);
        if (Date.now() / 1000 - authDate > 86400) {
          throw new Error('Telegram auth expired');
        }

        try {
          await connectDB();
        } catch {
          throw new Error('Database error');
        }

        const telegramId = credentials.id;
        let user = await User.findOne({
          provider: 'telegram',
          providerId: telegramId,
        });

        if (!user) {
          user = await User.create({
            email: `telegram_${telegramId}@telegram.storeit`,
            name:
              credentials.first_name +
              (credentials.last_name ? ` ${credentials.last_name}` : ''),
            image: credentials.photo_url || null,
            provider: 'telegram',
            providerId: telegramId,
          });
        }

        return {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          image: user.image ?? null,
          storageused: user.storageused,
          storagelimit: user.storagelimit,
        };
      },
    }),

    // ── Email / Password ──────────────────────────────────────────
    CredentialsProvider({
      id: 'credentials',
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
   async authorize(credentials, req) {
         if (typeof credentials?.email !== 'string' || typeof credentials?.password !== 'string') {
           throw new Error('Invalid credentials');
         }

         const email = credentials.email.toLowerCase().trim();
         const password = credentials.password;

         if (!email || password.length < 6) {
           throw new Error('Invalid credentials');
         }

         const ip = getClientIp((req?.headers ?? {}) as Record<string, string | string[] | undefined>);
         const emailKey = `login:email:${email}`;
         const ipKey = `login:ip:${ip}`;

         // Checked (not consumed) up front, before touching the DB or
         // spending a bcrypt compare on an already-locked-out target.
         if (isRateLimited(emailKey, LOGIN_EMAIL_LIMIT).limited || isRateLimited(ipKey, LOGIN_IP_LIMIT).limited) {
           throw new Error('Too many login attempts. Please try again later.');
         }

         try {
           await connectDB();
         } catch {
           throw new Error('Invalid credentials');
         }

         const user = await User.findOne({ email }).select('+password');
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
           id: user._id.toString(),
           name: user.name,
           email: user.email,
           image: user.image ?? null,
           storageused: user.storageused,
           storagelimit: user.storagelimit,
         };
       },
    }),
  ],

  // ── Callbacks ──────────────────────────────────────────────────
  callbacks: {
  async signIn({ user, account, profile }) {
    if (account?.provider === 'google') {
      try {
        await connectDB();

       const email = user.email?.toLowerCase();

   if (!email) {
  console.error("No email returned from Google");
  return false;
    }
    const existingUser = await User.findOne({ email });

        if (existingUser) {
          await User.updateOne(
            { email },
            {
              $set: {
                name: user.name,
                image: user.image,
                provider: 'google',
                providerId: profile?.sub,
              },
            }
          );
        } else {
          await User.create({
            email,
            name: user.name,
            image: user.image,
            provider: 'google',
            providerId: profile?.sub,
          });
        }
      } catch (err) {
        console.error('Google signIn error:', err);
        return false;
      }
    }
    // Telegram user was already created/updated in authorize()
    return true;
  },


    async jwt({ token, user, account }) {
      // ── First sign-in (any provider) ──────────────────────────
      if (account && user) {
        token.provider = account.provider;

        if (account.provider === 'credentials') {
          // Credentials: all data already in the user object returned by authorize()
          token.id = user.id;
          const appUser = user as AppAuthUser;
          token.storageused = appUser.storageused ?? 0;
          token.storagelimit = appUser.storagelimit ?? 5 * 1024 * 1024 * 1024;
        }

        if (account.provider === 'google' || account.provider === 'telegram') {
          // Google / Telegram: fetch storage + _id from DB (not in profile)
          try {
            await connectDB();
            const dbUser = await User.findOne({ email: token.email });
            if (dbUser) {
              token.id = dbUser._id.toString();
              token.storageused = dbUser.storageused;
              token.storagelimit = dbUser.storagelimit;
            }
          } catch (err) {
            console.error(`JWT ${account.provider} DB fetch error:`, err);
          }
        }
      }

      // Subsequent requests: return token as-is (no extra DB call)
      return token;
    },

    async session({ session, token }) {
      if (token && session.user) {
        session.user.email = token.email as string;
        session.user.id = token.id as string;
        session.user.provider = token.provider as string;
        session.user.storageused = token.storageused as number;
        session.user.storagelimit = token.storagelimit as number;
      }
      return session;
    },
  },

  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },

  secret: process.env.NEXTAUTH_SECRET,
  debug: false,
};

export default NextAuth(authOptions);
