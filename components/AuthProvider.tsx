'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { getDeviceDEK } from '@/client/lib/dekStore';
import { importDEK } from '@/client/lib/dek';
import { setSessionDEK, clearSessionDEK, base64ToBuffer } from '@/hooks/useFileEncryption';
import EncryptionSetupModal from './EncryptionSetupModal';
import EncryptionRecoveryModal from './EncryptionRecoveryModal';

// Set by the sign-in page's "recover my encrypted files" action — the only
// legitimate way the recovery modal is allowed to appear. Never set this
// anywhere else.
export const DEK_RECOVERY_REQUESTED_KEY = 'storeit_dek_recovery_requested';

// /share/** is a public, token-authenticated route with its own independent
// session system (see server/lib/shareSession.ts) — it must never touch the
// main app's session. Letting the ambient exchange bootstrap run there was
// the root cause of a real bug: a stale NextAuth session for a *different*
// account sitting in the browser would get silently exchanged into
// access_token/refresh_token (cookies are browser-wide, not per-tab),
// switching which account every tab is authenticated as just from opening a
// share link — no login action taken.
function isExemptFromSessionBootstrap(pathname: string | null): boolean {
  return !!pathname && pathname.startsWith('/share');
}

type AuthUser = {
  userId: string;
  email: string;
  provider: string;
  storageused: number;
  storagelimit: number;
};

type AuthContextValue = {
  user: AuthUser | null;
  isReady: boolean;
  isAuthenticated: boolean;
  exchangeSession: () => Promise<void>;
  logout: () => Promise<void>;
  // Called by the sign-in page's explicit "I have a recovery code" action —
  // the only place this should ever be called from. Arms the recovery
  // modal for the next time a user is authenticated (immediately, if
  // already logged in; otherwise once the in-progress login completes,
  // surviving a full-page OAuth redirect via sessionStorage).
  requestDekRecovery: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isReady: false,
  isAuthenticated: false,
  exchangeSession: async () => {},
  logout: async () => {},
  requestDekRecovery: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const exempt = isExemptFromSessionBootstrap(pathname);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [dekModal, setDekModal] = useState<'setup' | 'recovery' | null>(null);
  const [dekBootstrappedFor, setDekBootstrappedFor] = useState<string | null>(null);

  // Set for the duration of an explicit logout so a NextAuth `status` that
  // hasn't caught up to signOut() yet can't re-trigger exchangeSession and
  // silently resurrect the session mid-logout. Cleared once NextAuth
  // confirms the session is actually gone, so the next real login (status
  // flipping back to 'authenticated') is treated normally.
  const loggingOutRef = useRef(false);

  useEffect(() => {
    if (status === 'unauthenticated') loggingOutRef.current = false;
  }, [status]);

  const exchangeSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/exchange', { method: 'POST' });
      if (!res.ok) return;
      const data = await res.json();
      setUser(data.user);
    } catch {
      // silent
    }
  }, []);

  const logout = useCallback(async () => {
    loggingOutRef.current = true;
    // Clears both session systems from a single call site — a caller that
    // only cleared the app's own JWT (via /api/auth/logout) and forgot
    // NextAuth's signOut() would leave a real, valid NextAuth session
    // sitting in the browser, which is exactly the "two systems disagree"
    // shape this app has already been bitten by once (see
    // SESSION_EXCHANGE_VULNERABILITY.md). Doing both here means every
    // future logout entry point gets this for free instead of having to
    // remember to pair the calls itself.
    await Promise.all([
      fetch('/api/auth/logout', { method: 'POST' }),
      signOut({ redirect: false }),
    ]);
    setUser(null);
    clearSessionDEK();
    setDekModal(null);
    setDekBootstrappedFor(null);
  }, []);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      if (!res.ok) return false;
      const data = await res.json();
      setUser(data.user);
      return true;
    } catch {
      return false;
    }
  }, []);

  const [dekRecoveryTrigger, setDekRecoveryTrigger] = useState(0);

  const requestDekRecovery = useCallback(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(DEK_RECOVERY_REQUESTED_KEY, '1');
    }
    // Bumps the DEK-bootstrap effect's dependency so an already-logged-in
    // user (rare on the sign-in page, but possible) gets the modal
    // immediately instead of waiting on some unrelated state change.
    setDekRecoveryTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    if (status === 'loading') return;

    const init = async () => {
      // Public share routes never need the main app's session —
      // bootstrapping it there is exactly what let a stale, different-
      // account NextAuth session silently take over the browser's
      // cookies. See isExemptFromSessionBootstrap above.
      if (exempt || loggingOutRef.current) {
        setIsReady(true);
        return;
      }

      // Only ever refreshes an *existing* app session from its own
      // refresh_token — never mints a new one from whatever NextAuth
      // session happens to be sitting in the browser. exchangeSession() is
      // deliberately not called here: it's explicit-only now, invoked
      // directly by each login path the instant it knows a real sign-in
      // just happened in this tab (credentials: Authform.tsx right after
      // signIn() resolves; Telegram: TelegramLoginButton.tsx, same
      // pattern; Google: the marker-gated effect below, since its redirect
      // leaves and re-enters the page with no other way to signal "this
      // authenticated status is fresh, not a stale leftover session").
      await fetchUser();
      setIsReady(true);
    };

    init();
  }, [status, fetchUser, exempt]);

  // Explicit continuation of the Google OAuth redirect (see Authform.tsx's
  // callbackUrl). Gated on a one-time marker that only that redirect ever
  // sets — never on ambient session status — so a stale NextAuth session
  // from a different account can't trigger this just by being present.
  useEffect(() => {
    if (exempt || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('authExchange') !== '1') return;

    params.delete('authExchange');
    const newSearch = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (newSearch ? `?${newSearch}` : ''));

    void (async () => { await exchangeSession(); })();
  }, [exempt, exchangeSession]);

  // Bootstrap the session DEK once a user is authenticated — works the same
  // regardless of login method (credentials, Google, Telegram), since it
  // never depends on a password. A known device unlocks silently from its
  // local store. An unknown device (recovery code needed) never auto-shows
  // a modal for it — that's only reachable via the sign-in page's explicit
  // "recover my encrypted files" action (DEK_RECOVERY_REQUESTED_KEY), which
  // a brand-new-encryption account also skips since there's nothing to
  // recover yet, so 'setup' still opens automatically for those.
  useEffect(() => {
    if (!isReady || !user || exempt) return;

    const recoveryRequested = typeof window !== 'undefined'
      && sessionStorage.getItem(DEK_RECOVERY_REQUESTED_KEY) === '1';

    if (dekBootstrappedFor === user.userId && !recoveryRequested) return;

    let cancelled = false;

    (async () => {
      try {
        const deviceKeyBase64 = await getDeviceDEK(user.userId);
        if (deviceKeyBase64) {
          const dek = await importDEK(base64ToBuffer(deviceKeyBase64));
          if (!cancelled) {
            setSessionDEK(dek);
            setDekBootstrappedFor(user.userId);
          }
          if (recoveryRequested) sessionStorage.removeItem(DEK_RECOVERY_REQUESTED_KEY);
          return;
        }

        const res = await fetch('/api/auth/encryption/status');
        const data = res.ok ? await res.json() : { hasEncryption: false };
        if (cancelled) return;

        if (recoveryRequested) {
          sessionStorage.removeItem(DEK_RECOVERY_REQUESTED_KEY);
          setDekModal(data.hasEncryption ? 'recovery' : null);
        } else if (!data.hasEncryption) {
          setDekModal('setup');
        }
        setDekBootstrappedFor(user.userId);
      } catch {
        if (!cancelled) setDekBootstrappedFor(user.userId);
      }
    })();

    return () => { cancelled = true; };
  }, [isReady, user, dekBootstrappedFor, exempt, dekRecoveryTrigger]);

  return (
    <AuthContext.Provider value={{ user, isReady, isAuthenticated: !!user, exchangeSession, logout, requestDekRecovery }}>
      {children}
      {dekModal === 'setup' && user && (
        <EncryptionSetupModal userId={user.userId} onComplete={() => setDekModal(null)} />
      )}
      {dekModal === 'recovery' && user && (
        <EncryptionRecoveryModal
          userId={user.userId}
          onComplete={() => setDekModal(null)}
          onSkip={() => setDekModal(null)}
        />
      )}
    </AuthContext.Provider>
  );
}
