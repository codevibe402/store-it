import { authOptions } from '@/server/auth/config';
import NextAuth from 'next-auth';

export const GET = NextAuth(authOptions);
export const POST = NextAuth(authOptions);
