"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Folder as FolderIcon, FolderPlus, FilePlus } from "lucide-react";
import LogoutButton from "@/components/LogoutButton";

type FolderType = {
  _id: string;
  name: string;
  parent_id?: string | null;
};

type RightSidebarProps = {
  folders: FolderType[];
};

export default function RightSidebar({ folders }: RightSidebarProps) {
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isOpen, setIsOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleFolder = (folderId: string) => {
    const next = new Set(expandedFolders);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    setExpandedFolders(next);
  };

  const getSubfolders = (parentId: string | null) => folders.filter((f) => (f.parent_id ?? null) === parentId);
  const rootFolders = getSubfolders(null);

  const FolderItem = ({ folder }: { folder: FolderType }) => {
    const isExpanded = expandedFolders.has(folder._id);
    const hasChildren = getSubfolders(folder._id).length > 0;

    return (
      <div>
        <div className="flex items-center gap-1 rounded px-1 py-1 text-xs hover:bg-slate-800">
          <button onClick={() => toggleFolder(folder._id)} className="flex items-center gap-1 flex-1 text-left">
            {hasChildren ? (
              <ChevronRight className={`h-3 w-3 text-slate-500 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
            ) : (
              <span className="h-3 w-3" />
            )}
            <FolderIcon className="h-3.5 w-3.5 text-indigo-300" />
            <span className="truncate text-slate-200">{folder.name}</span>
          </button>
          <button onClick={() => router.push(`/folder/${folder._id}`)} className="rounded p-0.5 text-slate-400 hover:text-indigo-300" title="Add file">
            <FilePlus className="h-3 w-3" />
          </button>
          <button onClick={() => router.push(`/folder/${folder._id}?new=1`)} className="rounded p-0.5 text-slate-400 hover:text-indigo-300" title="Add folder">
            <FolderPlus className="h-3 w-3" />
          </button>
        </div>
        {isExpanded && hasChildren && (
          <div className="ml-4 mt-1 border-l border-slate-700 pl-2">
            {getSubfolders(folder._id).map((f) => (
              <FolderItem key={f._id} folder={f} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
        aria-label="Toggle folders"
        title="Folders"
      >
        <FolderIcon className="h-5 w-5" />
      </button>

      {isOpen && (
        <aside className="fixed inset-y-0 right-0 z-40 w-56 border-l border-slate-700 bg-slate-900/70 p-3 shadow-2xl">
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

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Folders</span>
                <button onClick={() => router.push("/dashboard?new=1")} className="rounded p-0.5 text-slate-400 hover:text-indigo-300" title="Add folder to root">
                  <FolderPlus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {rootFolders.length === 0 ? (
                  <p className="px-2 py-1 text-[10px] text-slate-500">No folders</p>
                ) : (
                  rootFolders.map((f) => (
                    <FolderItem key={f._id} folder={f} />
                  ))
                )}
              </div>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}