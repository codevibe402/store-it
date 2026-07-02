import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import connectDB from '@/lib/mongoose';
import User from '@/models/User';
import NextAuth, { NextAuthOptions } from 'next-auth';

type AppAuthUser = {
  storageused?: number;
  storagelimit?: number;
};

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

    // ── Email / Password ──────────────────────────────────────────
    CredentialsProvider({
      id: 'credentials',
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
   async authorize(credentials) {
         if (typeof credentials?.email !== 'string' || typeof credentials?.password !== 'string') {
           throw new Error('Invalid credentials');
         }

         const email = credentials.email.toLowerCase().trim();
         const password = credentials.password;

         if (!email || password.length < 6) {
           throw new Error('Invalid credentials');
         }

         try {
           await connectDB();
         } catch {
           throw new Error('Invalid credentials');
         }

         const user = await User.findOne({ email }).select('+password');
         if (!user) {
           throw new Error('Invalid credentials');
         }

         if (user.provider !== 'credentials' || !user.password) {
           throw new Error('Invalid credentials');
         }

         const isValid = await bcrypt.compare(password, user.password);
         if (!isValid) {
           throw new Error('Invalid credentials');
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
  return false; // or handle differently
    }
    const existingUser = await User.findOne({ email });

        if (existingUser) {
          await User.updateOne(
            { email },
            {
              $set: {
                name: user.name,
                image: user.image,
                provider: 'google', // switch provider
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

        if (account.provider === 'google') {
          // Google: fetch storage + _id from DB (not in OAuth profile)
          try {
            await connectDB();
            const dbUser = await User.findOne({ email: token.email });
            if (dbUser) {
              token.id = dbUser._id.toString();
              token.storageused = dbUser.storageused;
              token.storagelimit = dbUser.storagelimit;
            }
          } catch (err) {
            console.error('JWT Google DB fetch error:', err);
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
