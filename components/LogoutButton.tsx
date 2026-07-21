'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export default function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const { logout } = useAuth();

  const handleLogout = async () => {
    // logout() clears both session systems (app JWT + NextAuth) itself.
    await logout();
    router.push('/sign_in');
  };

  return (
    <button onClick={handleLogout} className={className}>
      Logout
    </button>
  );
}
