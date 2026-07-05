'use client';

import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useAuth } from '@/components/AuthProvider';

export default function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const { logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    await signOut({ redirect: false });
    router.push('/sign_in');
  };

  return (
    <button onClick={handleLogout} className={className}>
      Logout
    </button>
  );
}
