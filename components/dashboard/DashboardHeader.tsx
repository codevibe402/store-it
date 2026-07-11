"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";

type DashboardHeaderProps = {
  fileCount: number;
  currentFolder?: { name: string } | null;
};

export default function DashboardHeader({ fileCount, currentFolder }: DashboardHeaderProps) {
  const router = useRouter();

  const handleLogout = async () => {
    await signOut({ redirect: false });
    router.push("/sign_in");
  };

  return (
    <header className="flex items-center justify-between">
      <h1 className="bg-gradient-to-r from-white to-indigo-400 bg-clip-text text-[1.5rem] font-bold tracking-tight text-transparent">
        StoreIt
      </h1>
      <div className="flex items-center gap-2">
        <button
          className="rounded-lg border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20"
          onClick={handleLogout}
        >
          Logout
        </button>
      </div>
    </header>
  );
}