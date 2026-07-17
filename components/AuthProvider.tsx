'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { getDeviceDEK } from '@/client/lib/dekStore';
import { importDEK } from '@/client/lib/dek';
import { setSessionDEK, clearSessionDEK, base64ToBuffer } from '@/hooks/useFileEncryption';
import EncryptionSetupModal from './EncryptionSetupModal';
import EncryptionRecoveryModal from './EncryptionRecoveryModal';

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
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isReady: false,
  isAuthenticated: false,
  exchangeSession: async () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [dekModal, setDekModal] = useState<'setup' | 'recovery' | null>(null);
  const [dekBootstrappedFor, setDekBootstrappedFor] = useState<string | null>(null);

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
      setUser(data.user);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (status === 'loading') return;

    const init = async () => {
      const hasTokens = await fetchUser();
      if (!hasTokens && status === 'authenticated') {
        await exchangeSession();
      }
      setIsReady(true);
    };

    init();
  }, [status, fetchUser, exchangeSession]);

  // Bootstrap the session DEK once a user is authenticated — works the same
  // regardless of login method (credentials, Google, Telegram), since it
  // never depends on a password. A known device unlocks silently from its
  // local store; a new device needs the recovery code once.
  useEffect(() => {
    if (!isReady || !user || dekBootstrappedFor === user.userId) return;

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
          return;
        }

        const res = await fetch('/api/auth/encryption/status');
        const data = res.ok ? await res.json() : { hasEncryption: false };
        if (cancelled) return;

        setDekModal(data.hasEncryption ? 'recovery' : 'setup');
        setDekBootstrappedFor(user.userId);
      } catch {
        if (!cancelled) setDekBootstrappedFor(user.userId);
      }
    })();

    return () => { cancelled = true; };
  }, [isReady, user, dekBootstrappedFor]);

  return (
    <AuthContext.Provider value={{ user, isReady, isAuthenticated: !!user, exchangeSession, logout }}>
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
