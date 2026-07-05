'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';

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

  return (
    <AuthContext.Provider value={{ user, isReady, isAuthenticated: !!user, exchangeSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
