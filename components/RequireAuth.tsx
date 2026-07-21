'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

// Client-side backstop behind middleware.ts's coarse cookie-presence check.
// middleware.ts only confirms an access_token cookie exists, not that it's
// still a valid JWT — a present-but-expired token (they last 15 minutes;
// see server/auth/auth.ts's ACCESS_COOKIE_OPTIONS) passes that check fine.
// This uses useAuth() — the app's own JWT session, which every API route
// actually enforces — never useSession() (NextAuth's session), which can
// disagree with it (see SESSION_EXCHANGE_VULNERABILITY.md). Once
// AuthProvider has resolved (isReady) and found no real session, redirect
// to sign-in instead of rendering the protected page with nothing in it.
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isReady, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace('/sign_in');
    }
  }, [isReady, isAuthenticated, router]);

  if (!isReady || !isAuthenticated) return null;

  return <>{children}</>;
}
