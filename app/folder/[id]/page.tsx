"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { MoreHorizontal, ArrowLeft } from "lucide-react";
import { useFolders } from "@/hooks/useFolders";

type FolderType = {
  _id: string;
  name: string;
  owner_id: string;
  parent_id?: string | null;
  createdAt: string;
};

export default function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status: sessionStatus } = useSession();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [ctxMenuTarget, setCtxMenuTarget] = useState<{ folder: FolderType; element: HTMLElement } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    params.then((p) => setFolderId(p.id));
  }, [params]);

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

  if (sessionStatus !== "authenticated") return null;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#0b1220_0%,#111827_100%)] py-8 text-slate-100">
      <div className="mx-auto max-w-3xl px-6">
        <header className="mb-6 flex items-center gap-3 border-b border-slate-700 pb-4">
          <button onClick={() => router.push("/dashboard")} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold text-white">{folder?.name || "Folder"}</h1>
        </header>

        <section>
          {subfolders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-600 bg-slate-900/40 py-16 text-center">
              <p className="text-sm text-slate-400">This folder is empty</p>
            </div>
          ) : (
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
          )}
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
          <button onClick={() => { if (confirm(`Delete folder "${ctxMenuTarget.folder.name}"?`)) { folderActions.deleteFolder(ctxMenuTarget.folder._id); router.push("/dashboard"); } setCtxMenuTarget(null); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-300 hover:bg-red-500/10">Delete</button>
        </div>
      )}
    </main>
  );
}