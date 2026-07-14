"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  Folder as FolderIcon,
  FolderPlus,
  MoreHorizontal,
  Search,
} from "lucide-react";
import FileUpload from "@/components/ui/fileupload";
import { useFiles } from "@/hooks/useFiles";
import { useFolders } from "@/hooks/useFolders";
import { ShareDialog, DeleteDialog, VersionsDialog, MoveDialog } from "@/components/dialogs";
import RecycleBinSidebar from "@/components/RecycleBinSidebar";
import { ChevronDown } from "lucide-react";

type FileType = {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  hash?: string;
  storageUrl: string;
  owner_id: string;
  status: "pending" | "uploading" | "paused" | "fallback_cleanup" | "s3_pending" | "uploaded" | "cancelled" | "failed";
  folderId: string | null;
  createdAt: string;
  backend?: "s3" | "telegram";
};

type FolderType = {
  _id: string;
  name: string;
  owner_id: string;
  parent_id?: string | null;
  createdAt: string;
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
export default function DashboardPage() {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("recent");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Simple 3-dot menu: track which file's menu is open + ref for detecting outside clicks
  const [ctxMenuTarget, setCtxMenuTarget] = useState<{ fileId: string; element: HTMLElement } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenuTarget) return;
    const handler = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenuTarget(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenuTarget]);

  const { data: dashboard, isLoading } = useQuery<{ files: FileType[]; folders: FolderType[] }>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const response = await fetch("/api/dashboard");
      if (!response.ok) throw new Error("Failed to load dashboard");
      return response.json();
    },
    enabled: isAuthenticated,
    refetchInterval: 15000,
  });

  const files = useMemo(() => dashboard?.files ?? [], [dashboard?.files]);
  const folders = useMemo(() => dashboard?.folders ?? [], [dashboard?.folders]);

  const fileActions = useFiles(files, folders);
  const folderActions = useFolders(folders, null);

  const visibleFolders = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = folders.filter((folder) => {
      if ((folder.parent_id ?? null) !== null) return false;
      if (normalizedSearch && !folder.name.toLowerCase().includes(normalizedSearch)) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (sortOrder === "name") return a.name.localeCompare(b.name);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [folders, search, sortOrder]);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const ok = await folderActions.createFolder(newFolderName.trim(), null);
    if (ok) {
      setNewFolderName("");
      setShowNewFolder(false);
    }
  };

  const handleRenameSubmit = (folder: FolderType) => {
    if (renameValue.trim() && renameValue !== folder.name) {
      folderActions.renameFolder(folder, renameValue.trim());
    }
    setRenameId(null);
    setCtxMenuTarget(null);
  };

  const openMenu = (folder: FolderType, btn: HTMLElement) => {
    setCtxMenuTarget({ fileId: folder._id, element: btn });
  };

  return (
    <div className="flex min-h-screen bg-[linear-gradient(180deg,#0b1220_0%,#111827_100%)] text-slate-100">
      <RecycleBinSidebar />
      <main className="flex-1 py-5 pl-64 text-slate-100 sm:py-8">
        <div className="mx-auto w-[90%]">
          <header className="flex items-center justify-between border-b border-slate-700/70 pb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-lg font-bold text-white shadow-lg shadow-indigo-950/30">S</div>
              <h1 className="text-xl font-semibold tracking-tight text-white">StoreIt</h1>
            </div>
          </header>

          <section className="py-8">
            <h2 className="text-3xl font-bold tracking-tight text-white">Storage</h2>
            <p className="mt-2 text-base text-slate-400">Upload, organize, and share your files from one place.</p>
          </section>

          <section className="flex flex-wrap items-end justify-between gap-3 border-y border-slate-700/70 py-5">
            <div className="flex flex-wrap items-end gap-3 flex-1 lg:grid lg:grid-cols-[minmax(320px,1fr)_160px_160px]">
              <label className="flex h-11 items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/70 px-3 text-slate-400 transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-400/20">
                <Search className="h-5 w-5" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500" placeholder="Search folders..." />
              </label>
              <label className="relative">
                <span className="sr-only">Sort folders</span>
                <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="h-11 w-full appearance-none rounded-xl border border-slate-700 bg-slate-900/70 px-3 pr-9 text-sm text-slate-200 outline-none transition hover:border-slate-600 focus:border-indigo-400">
                  <option value="recent">Recently created</option>
                  <option value="name">Name</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
              </label>
            </div>
            <button
              type="button"
              onClick={() => { setShowNewFolder(true); setNewFolderName(""); }}
              className="flex h-11 items-center gap-2 rounded-xl border border-indigo-500/50 bg-indigo-500/15 px-4 text-sm font-medium text-indigo-300 transition hover:border-indigo-400 hover:bg-indigo-500/20 hover:text-indigo-200 shrink-0"
            >
              <FolderPlus className="h-4 w-4" />
              New Folder
            </button>
          </section>

          {showNewFolder && (
            <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50" onClick={() => setShowNewFolder(false)}>
              <div className="bg-[#1a1e28] border border-[#252a38] rounded-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-[1.05rem] font-semibold text-[#e8eaf0] mb-4">Create a new folder</h3>
                <input
                  autoFocus
                  className="w-full bg-[#13161e] border border-[#252a38] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#6c8eff]/50 mb-4"
                  placeholder="Folder name"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); }}
                />
                <div className="flex gap-2">
                  <button onClick={handleCreateFolder} className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 transition">Create</button>
                  <button onClick={() => setShowNewFolder(false)} className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white transition">Cancel</button>
                </div>
              </div>
            </div>
          )}

          <section className="py-8">
            <FileUpload currentFolderId={null} />
          </section>

          <section className="pb-8">
            <div className="mb-5 flex items-end justify-between">
              <div>
                <p className="text-sm font-medium text-indigo-300">Root folders</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Folders ({visibleFolders.length})</h2>
              </div>
            </div>

            {isLoading ? (
              <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-6 text-sm text-slate-400">Loading folders...</div>
            ) : visibleFolders.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-600 bg-slate-900/40 py-16 text-center">
                <FolderIcon className="mx-auto h-10 w-10 text-slate-500" />
                <p className="mt-3 text-sm text-slate-400">No folders yet. Click "New Folder" to create one.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleFolders.map((folder) => (
                  <article key={folder._id} className="group relative flex min-h-[76px] flex-col gap-4 rounded-xl border border-slate-700 bg-[#111827] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-400/60 hover:shadow-lg hover:shadow-indigo-950/20 sm:flex-row sm:items-center">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300"><FolderIcon className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-base font-semibold text-slate-100">{folder.name}</h3>
                      <p className="mt-1 text-sm text-slate-400">{formatDate(folder.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 sm:ml-auto">
                      <button
                        type="button"
                        aria-label={`More actions for ${folder.name}`}
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); openMenu(folder, e.currentTarget as HTMLElement); }}
                        className="rounded-lg p-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"
                      >
                        <MoreHorizontal className="h-5 w-5" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* 3-dot context menu — rendered at top level, stable positioning */}
      {ctxMenuTarget && (() => {
        const folder = visibleFolders.find((f) => f._id === ctxMenuTarget.fileId);
        if (!folder) return null;
        const rect = ctxMenuTarget.element.getBoundingClientRect();
        return (
          <div
            ref={ctxMenuRef}
            className="fixed z-40 w-44 rounded-xl border border-slate-700 bg-[#111827] p-1.5 shadow-2xl shadow-black/40"
            style={{
              top: Math.min(rect.bottom + 4, window.innerHeight - 300),
              left: Math.min(rect.right - 176, window.innerWidth - 184),
            }}
          >
            {renameId === folder._id ? (
              <div className="px-2 py-1.5">
                <input
                  autoFocus
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSubmit(folder);
                    if (e.key === "Escape") { setRenameId(null); setCtxMenuTarget(null); }}
                  }
                />
                <div className="flex gap-1 mt-1">
                  <button onClick={() => handleRenameSubmit(folder)} className="flex-1 px-2 py-1 text-[10px] rounded bg-indigo-500 text-white hover:bg-indigo-400">OK</button>
                  <button onClick={() => { setRenameId(null); setCtxMenuTarget(null); }} className="flex-1 px-2 py-1 text-[10px] rounded border border-gray-600 text-gray-400 hover:bg-gray-800">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <button onClick={() => { setRenameId(folder._id); setRenameValue(folder.name); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800">Rename</button>
                <button onClick={() => { folderActions.deleteFolder(folder._id); setCtxMenuTarget(null); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-300 transition hover:bg-red-500/10">Delete</button>
              </>
            )}
          </div>
        );
      })()}

      <ShareDialog
        shareTarget={fileActions.shareTarget as any}
        setShareTarget={fileActions.setShareTarget as any}
        shareUrl={fileActions.shareUrl}
        setShareUrl={fileActions.setShareUrl}
        shareCopied={fileActions.shareCopied}
        setShareCopied={fileActions.setShareCopied}
        sharePermission={fileActions.sharePermission}
        setSharePermission={fileActions.setSharePermission}
        shareExpiresInDays={fileActions.shareExpiresInDays}
        setShareExpiresInDays={fileActions.setShareExpiresInDays}
        onCopyUrl={() => {
          if (fileActions.shareTarget) {
            const isFolder = fileActions.shareTarget.type === "folder";
            fileActions.copyShareUrl(fileActions.shareTarget.item, isFolder);
          }
        }}
        onGenerateFolderShare={() => {
          if (fileActions.shareTarget?.type === "folder") {
            fileActions.openFolderShareModal(fileActions.shareTarget.item, fileActions.sharePermission);
          }
        }}
        onGenerateFileShare={() => {
          if (fileActions.shareTarget?.type === "file") {
            fileActions.openShareModal(fileActions.shareTarget.item);
          }
        }}
      />
      <DeleteDialog
        deleteTarget={fileActions.deleteTarget as any}
        setDeleteTarget={fileActions.setDeleteTarget as any}
        onDelete={async () => {
          if (!fileActions.deleteTarget) return;
          if (fileActions.deleteTarget.type === "file") {
            await fileActions.deleteFile(fileActions.deleteTarget.item._id);
          } else {
            await fileActions.deleteFolder(fileActions.deleteTarget.item._id);
          }
          fileActions.setDeleteTarget(null);
        }}
      />
      <MoveDialog
        moveTarget={fileActions.moveTarget as any}
        setMoveTarget={fileActions.setMoveTarget as any}
        folders={folders}
        uploadedFiles={files.filter((f) => f.status === "uploaded")}
        currentFolderId={null}
        newFolderName={newFolderName}
        setNewFolderName={setNewFolderName}
        onCreateFolder={async () => {
          if (!newFolderName.trim()) return;
          await folderActions.createFolder(newFolderName.trim(), null);
          setNewFolderName("");
        }}
        onMove={async (targetFolderId) => {
          if (fileActions.moveTarget) {
            await fileActions.moveFile(fileActions.moveTarget, targetFolderId);
          }
          fileActions.setMoveTarget(null);
        }}
      />
      <VersionsDialog
        versionTarget={fileActions.versionTarget}
        setVersionTarget={fileActions.setVersionTarget}
        versions={fileActions.versions}
        versionsLoading={fileActions.versionsLoading}
        onOpenVersion={fileActions.openVersionUrl}
      />
    </div>
  );
}