"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { MoreHorizontal, ArrowLeft, FolderPlus, FilePlus } from "lucide-react";
import { useFolders } from "@/hooks/useFolders";
import FileUpload from "@/components/ui/fileupload";

type FolderType = {
  _id: string;
  name: string;
  owner_id: string;
  parent_id?: string | null;
  createdAt: string;
};

export default function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { status: sessionStatus } = useSession();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [ctxMenuTarget, setCtxMenuTarget] = useState<{ folder: FolderType; element: HTMLElement } | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    params.then((p) => setFolderId(p.id));
  }, [params]);

  useEffect(() => {
    if (searchParams?.get("new") === "1") setShowNewFolder(true);
  }, [searchParams]);

  const { data: folder } = useQuery<FolderType>({
    queryKey: ["folder", folderId],
    queryFn: async () => {
      const res = await fetch(`/api/folders/${folderId}`);
      if (!res.ok) return null;
      const d = await res.json();
      return d.folder;
    },
    enabled: !!folderId && sessionStatus === "authenticated",
  });

  const { data: subfolders = [] } = useQuery<FolderType[]>({
    queryKey: ["subfolders", folderId],
    queryFn: async () => {
      const res = await fetch(`/api/folders?parent_id=${folderId}`);
      if (!res.ok) return [];
      const d = await res.json();
      return d.folders || [];
    },
    enabled: !!folderId && sessionStatus === "authenticated",
  });

  const { data: files = [] } = useQuery<{ _id: string; filename: string; size: number; createdAt: string }[]>({
    queryKey: ["folder-files", folderId],
    queryFn: async () => {
      const res = await fetch(`/api/files?folder_id=${folderId}`);
      if (!res.ok) return [];
      const d = await res.json();
      return d.files || [];
    },
    enabled: !!folderId && sessionStatus === "authenticated",
  });

  const folderActions = useFolders(subfolders, folderId);

  const openFolderMenu = (folder: FolderType, btn: HTMLElement) => {
    setCtxMenuTarget({ folder, element: btn });
  };

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

  const handleRenameSubmit = async (folder: FolderType) => {
    if (renameValue.trim() && renameValue !== folder.name) {
      await folderActions.renameFolder(folder, renameValue.trim());
    }
    setRenameId(null);
    setCtxMenuTarget(null);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const ok = await folderActions.createFolder(newFolderName.trim(), folderId);
    if (ok) {
      setNewFolderName("");
      setShowNewFolder(false);
    }
  };

  if (sessionStatus !== "authenticated") return null;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#0b1220_0%,#111827_100%)] py-8 pl-64 text-slate-100">
      <div className="mx-auto max-w-3xl px-6">
        <header className="mb-6 flex items-center justify-between border-b border-slate-700 pb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/dashboard")} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-semibold text-white">{folder?.name || "Folder"}</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowNewFolder(true)} className="flex h-8 items-center gap-1 rounded-lg border border-indigo-500/50 bg-indigo-500/15 px-2 text-xs font-medium text-indigo-300 hover:border-indigo-400 hover:bg-indigo-500/20">
              <FolderPlus className="h-3 w-3" />
              Add Folder
            </button>
            <button onClick={() => document.querySelector('input[type="file"]')?.dispatchEvent(new MouseEvent("click"))} className="flex h-8 items-center gap-1 rounded-lg border border-indigo-500/50 bg-indigo-500/15 px-2 text-xs font-medium text-indigo-300 hover:border-indigo-400 hover:bg-indigo-500/20">
              <FilePlus className="h-3 w-3" />
              Add File
            </button>
          </div>
        </header>

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

        <section>
          <div className="space-y-3">
            {subfolders.map((f) => (
              <div key={f._id} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                {renameId === f._id ? (
                  <input
                    autoFocus
                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white outline-none"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameSubmit(f);
                      if (e.key === "Escape") { setRenameId(null); setCtxMenuTarget(null); }
                    }}
                    onBlur={() => { setRenameId(null); setCtxMenuTarget(null); }}
                  />
                ) : (
                  <span className="text-slate-200">{f.name}</span>
                )}
                <button onClick={(e) => { if (renameId !== f._id) openFolderMenu(f, e.currentTarget as HTMLElement); }} className="rounded p-1 text-slate-400 hover:bg-slate-800">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <FileUpload currentFolderId={folderId} />
        </section>
      </div>

      {ctxMenuTarget && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 w-48 rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-xl"
          style={{ top: ctxMenuTarget.element.getBoundingClientRect().bottom + 4, left: ctxMenuTarget.element.getBoundingClientRect().left }}
        >
          <button onClick={() => { router.push(`/folder/${ctxMenuTarget.folder._id}`); setCtxMenuTarget(null); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800">Open</button>
          <button onClick={() => { setRenameId(ctxMenuTarget.folder._id); setRenameValue(ctxMenuTarget.folder.name); setCtxMenuTarget(null); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800">Rename</button>
          <button onClick={() => { setCtxMenuTarget(null); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800">Move</button>
          <button onClick={() => { if (confirm(`Delete folder "${ctxMenuTarget.folder.name}"?`)) { folderActions.deleteFolder(ctxMenuTarget.folder._id); } setCtxMenuTarget(null); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-300 hover:bg-red-500/10">Delete</button>
        </div>
      )}
    </main>
  );
}