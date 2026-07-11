"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import FileSearch from "@/components/ui/filesearch";
import FileUpload from "@/components/ui/fileupload";
import { cn } from "@/shared/utils";

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

type ToastMsg = { msg: string; type: "error" | "warn" | "success" };
type ContextMenu = { x: number; y: number; item: FileType | FolderType; itemType: "file" | "folder" };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getFileIcon(mimetype: string): string {
  if (mimetype.startsWith("image/")) return "[IMG]";
  if (mimetype.startsWith("video/")) return "[VID]";
  if (mimetype.startsWith("audio/")) return "[AUD]";
  if (mimetype.includes("pdf")) return "[PDF]";
  if (mimetype.includes("zip") || mimetype.includes("compressed")) return "[ARC]";
  if (mimetype.includes("word") || mimetype.includes("document")) return "[DOC]";
  if (mimetype.includes("sheet") || mimetype.includes("excel")) return "[SHT]";
  return "[FILE]";
}

export default function DashboardPage() {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";

  const [showSearch, setShowSearch] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const [currentFolderId] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctxMenu]);

  const { data: dashboard, isLoading: dashboardLoading } = useQuery<{
    files: FileType[];
    folders: FolderType[];
    pendingFiles: FileType[];
  }>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    enabled: isAuthenticated,
    refetchInterval: 15000,
  });

  const files = dashboard?.files ?? [];
  const folders = dashboard?.folders ?? [];
  const uploadedFiles = files.filter((f) => f.status === "uploaded");
  const visibleFiles = uploadedFiles.filter((f) => f.folderId === currentFolderId);
  const currentFolder = folders.find((f) => f._id === currentFolderId);

  const handleLogout = async () => {
    await fetch('/api/auth/signout');
    router.push('/sign_in');
  };

  const handleUploadComplete = () => {
    // Trigger refetch to show newly uploaded file
    // useQuery will auto-refetch due to refetchInterval
  };

  const openCtx = (e: React.MouseEvent, item: FileType | FolderType, itemType: "file" | "folder") => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 160;
    const menuHeight = 280;
    let left = e.clientX;
    let top = e.clientY;
    if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - 8 - menuWidth;
    if (top + menuHeight > window.innerHeight) {
      top = e.clientY - 6 - menuHeight;
      if (top < 8) top = 8;
    }
    if (left < 8) left = 8;
    setCtxMenu({ x: left, y: top, item, itemType });
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0b0f] px-4 py-5 text-[#e8eaf0] sm:px-6 sm:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 -left-32 h-[600px] w-[600px] rounded-full bg-indigo-500/20 blur-[120px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -right-20 h-[500px] w-[500px] rounded-full bg-violet-500/15 blur-[120px]" />

      {showSearch && <FileSearch onClose={() => setShowSearch(false)} topOffset={16} />}

      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <header className="flex items-center justify-between border-b border-[#252a38] pb-5">
          <h1 className="bg-gradient-to-r from-white to-indigo-400 bg-clip-text text-[1.5rem] font-bold tracking-tight text-transparent">
            StoreIt
          </h1>
          <button
            className="rounded-lg border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20"
            onClick={handleLogout}
          >
            Logout
          </button>
        </header>

        <section className="mx-auto mt-8 flex w-full max-w-4xl flex-col gap-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-[#e8eaf0]">Storage</p>
              <p className="mt-1 text-sm text-[#6b7280]">Upload, organize, and share your files.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-lg border border-gray-600 bg-transparent px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:bg-gray-800"
                onClick={() => setShowSearch(true)}
                aria-label="Search files"
              >
                <svg className="inline-block w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21L14.35 14.35"/></svg>
              </button>
              <button
                className="rounded-lg border border-gray-600 bg-transparent px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:bg-gray-800"
                onClick={() => router.push("/all-files")}
                aria-label="View all files"
              >
                All files
              </button>
              <button
                className="rounded-lg border border-[#6c8eff]/30 bg-[#6c8eff1a] px-3 py-1.5 text-xs font-medium text-[#6c8eff] transition hover:bg-[#6c8eff25]"
                onClick={() => router.push("/sidebar")}
                aria-label="Browse by type"
              >
                Browse by type
              </button>
            </div>

          </div>

          <div className="rounded-xl border border-[#252a38] bg-[#11141c]/80 p-4 sm:p-5">
            <FileUpload currentFolderId={currentFolderId} onUploadComplete={handleUploadComplete} />
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#e8eaf0]">Files</h2>
            <span className="text-sm text-[#6b7280]">{visibleFiles.length} file{visibleFiles.length !== 1 ? "s" : ""}</span>
          </div>

          {dashboardLoading ? (
            <div className="rounded-xl border border-[#252a38] bg-[#13161e] p-5 text-sm text-[#6b7280]">Loading files…</div>
            ) : visibleFiles.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#252a38] py-12 text-center text-sm text-[#6b7280]">
                <div className="text-2xl mb-4 opacity-40">📂</div>
                <div>{currentFolder ? "No files in this folder yet" : "No files uploaded yet"}</div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {visibleFiles.slice(0, 10).map((file) => (
                  <div
                    key={file._id}
                    onContextMenu={(e) => openCtx(e, file, "file")}
                    className="flex items-center gap-3 rounded-xl border border-[#252a38] bg-[#13161e] px-3 py-3 transition-colors hover:border-[#3b4355]"
                  >
                    <div className="text-[20px] flex-shrink-0">{getFileIcon(file.mimetype)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[0.85rem] font-medium text-[#e8eaf0] truncate">{file.filename}</div>
                      <div className="text-[0.7rem] text-[#6b7280] truncate">
                        {formatBytes(file.size)} - {new Date(file.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff] hover:bg-[#6c8eff25]"
                        onClick={() => {}}
                      >
                        Open
                      </button>
                      <button
                        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition border-green-600/30 bg-green-500/10 text-green-400 hover:bg-green-500/20"
                        onClick={() => {}}
                      >
                        Share
                      </button>
                      <button
                        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition border-[#252a38] text-[#6b7280] bg-[#13161e] hover:bg-[#1a1e28] focus:outline-none focus:ring-2 focus:ring-[#6c8eff] focus:ring-offset-2"
                        aria-label="Open file options menu"
                        aria-haspopup="true"
                        aria-expanded={false}
                        onClick={(e) => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const menuWidth = 160;
                          let left = rect.right - menuWidth;
                          if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - 8 - menuWidth;
                          if (left < 8) left = 8;
                          const menuHeight = 280;
                          let top = rect.bottom + 6;
                          if (top + menuHeight > window.innerHeight) {
                            top = rect.top - 6 - menuHeight;
                            if (top < 8) top = 8;
                          }
                          setCtxMenu({ x: left, y: top, item: file, itemType: "file" });
                        }}
                      >
                        ⋮
                      </button>
                    </div>
                  </div>
                ))}
              </div>
          )}
        </section>
      </div>

      {toast && (
        <div
          className={cn(
            "fixed bottom-7 right-7 z-50 rounded-xl px-4 py-3 text-sm font-medium",
            "flex items-center gap-2 max-w-xs border",
            toast.type === "success"
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : toast.type === "warn"
                ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                : "border-red-500/30 bg-red-500/10 text-red-400"
          )}
        >
          <span className="text-xl font-bold">
            {toast.type === "success" ? "✓" : toast.type === "warn" ? "!" : "✕"}
          </span>
          {toast.msg}
        </div>
      )}
    </main>
  );
}
