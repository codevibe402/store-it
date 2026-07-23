'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
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
// main app's session (no reason to spend a refresh round-trip or run DEK
// bootstrap on a page anyone can open via a link).
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
  // Called by each login path (Authform.tsx, TelegramLoginButton.tsx) with
  // the `{user}` its own POST already returned, so the client's session
  // state updates immediately without a redundant extra round-trip.
  setAuthUser: (user: AuthUser) => void;
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
  setAuthUser: () => {},
  logout: async () => {},
  requestDekRecovery: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const exempt = isExemptFromSessionBootstrap(pathname);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [dekModal, setDekModal] = useState<'setup' | 'recovery' | null>(null);
  const [dekBootstrappedFor, setDekBootstrappedFor] = useState<string | null>(null);

  // Set for the duration of an explicit logout so the 10-minute silent
  // refresh interval (below) can't land its response after logout's own
  // setUser(null) and resurrect a "still logged in" UI even though the
  // server-side refresh token was just revoked.
  const loggingOutRef = useRef(false);

  const setAuthUser = useCallback((newUser: AuthUser) => {
    // A real login always supersedes a prior logout-in-flight, even if the
    // silent-refresh interval's guard above hasn't cleared yet.
    loggingOutRef.current = false;
    setUser(newUser);
  }, []);

  const logout = useCallback(async () => {
    loggingOutRef.current = true;
    await fetch('/api/auth/logout', { method: 'POST' });
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
      if (!loggingOutRef.current) setUser(data.user);
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
    const init = async () => {
      // Public share routes never need the main app's session bootstrapped.
      // Google's callback route (app/api/auth/google/callback/route.ts) sets
      // access_token/refresh_token cookies server-side before ever
      // redirecting here, so a plain fetchUser() on mount picks up a fresh
      // Google login exactly the same way it picks up any other existing
      // session — no marker/exchange step needed.
      if (exempt) {
        setIsReady(true);
        return;
      }

      await fetchUser();
      setIsReady(true);
    };

    init();
  }, [fetchUser, exempt]);

  // Silently keeps access_token alive for as long as the tab stays open.
  // Nothing else in the app ever refreshes it proactively — fetchUser() is
  // otherwise only called once, at mount. access_token expires after 15
  // minutes (ACCESS_COOKIE_OPTIONS.maxAge, server/auth/auth.ts) with no
  // auto-refresh-on-401 anywhere in the client's fetch calls, so any
  // long-running operation (a large-file Telegram upload, which chunks
  // sequentially and can easily run past 15 minutes) or simply an idle tab
  // left open past that window starts getting a flat 401 on every request
  // — which for the upload chunk loop in hooks/useUpload.ts looks like
  // "chunk failed after 3 attempts" with no S3-fallback trigger, since the
  // 401 response carries no canFallbackToS3 flag. A fixed interval well
  // under the 15-minute lifetime, calling the same already-safe
  // fetchUser() the initial mount uses (renews the session's own,
  // already-verified refresh_token), keeps it from ever going stale while
  // the tab is open.
  useEffect(() => {
    if (exempt || !user) return;
    const interval = setInterval(() => { void fetchUser(); }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [exempt, user, fetchUser]);

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
    <AuthContext.Provider value={{ user, isReady, isAuthenticated: !!user, setAuthUser, logout, requestDekRecovery }}>
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
