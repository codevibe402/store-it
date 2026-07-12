"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Folder as FolderIcon } from "lucide-react";
import LogoutButton from "@/components/LogoutButton";

type RightSidebarProps = {
  folders: { _id: string; name: string }[];
};

export default function RightSidebar({ folders }: RightSidebarProps) {
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const foldersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
      if (foldersRef.current && !foldersRef.current.contains(e.target as Node)) setFoldersOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <aside className="w-48 flex-shrink-0 border-l border-slate-700 bg-slate-900/70 p-3">
      <div className="flex flex-col gap-3">
        <div className="relative" ref={profileRef}>
          <button
            type="button"
            onClick={() => setProfileOpen((open) => !open)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/50 px-2 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
            aria-expanded={profileOpen}
            aria-label="Open profile menu"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/20 text-[10px] font-semibold text-indigo-200">U</span>
            <ChevronDown className="h-3 w-3 text-slate-400" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-10 z-30 w-40 rounded-lg border border-slate-700 bg-[#111827] p-1 shadow-xl">
              <LogoutButton className="w-full rounded px-2 py-1 text-left text-xs text-red-300 transition hover:bg-red-500/10" />
            </div>
          )}
        </div>

        <div className="relative" ref={foldersRef}>
          <button
            type="button"
            onClick={() => setFoldersOpen((o) => !o)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/50 px-2 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
            aria-expanded={foldersOpen}
            aria-label="Open folders menu"
          >
            <FolderIcon className="h-3.5 w-3.5 text-indigo-300" />
            <span className="text-xs text-slate-400">Folders {folders.length}</span>
            <ChevronDown className="h-3 w-3 text-slate-400" />
          </button>
          {foldersOpen && (
            <div className="absolute right-0 top-10 z-30 w-44 rounded-lg border border-slate-700 bg-[#111827] p-1 shadow-xl">
              {folders.length === 0 ? (
                <p className="px-2 py-1 text-[10px] text-slate-500">No folders</p>
              ) : (
                folders.map((f) => (
                  <button key={f._id} onClick={() => { setFoldersOpen(false); router.push(`/folder/${f._id}`); }} className="w-full rounded px-2 py-1 text-left text-xs text-slate-200 transition hover:bg-slate-800">
                    {f.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}