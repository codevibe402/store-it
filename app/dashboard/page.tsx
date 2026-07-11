"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  Archive,
  ChevronDown,
  Download,
  File,
  FileText,
  Folder,
  Image as ImageIcon,
  MoreHorizontal,
  Search,
  Share2,
  Video,
} from "lucide-react";
import FileUpload from "@/components/ui/fileupload";

type FileType = {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  storageUrl: string;
  status: "pending" | "uploading" | "paused" | "fallback_cleanup" | "s3_pending" | "uploaded" | "cancelled" | "failed";
  folderId: string | null;
  createdAt: string;
};

type MenuTarget = { x: number; y: number; file: FileType };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function FileTypeIcon({ mimetype }: { mimetype: string }) {
  const iconClass = "h-5 w-5";
  const wrapperClass = "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl";

  if (mimetype.startsWith("video/")) return <div className={`${wrapperClass} bg-violet-500/15 text-violet-300`}><Video className={iconClass} /></div>;
  if (mimetype.startsWith("image/")) return <div className={`${wrapperClass} bg-emerald-500/15 text-emerald-300`}><ImageIcon className={iconClass} /></div>;
  if (mimetype.includes("pdf")) return <div className={`${wrapperClass} bg-red-500/15 text-red-300`}><FileText className={iconClass} /></div>;
  if (mimetype.includes("zip") || mimetype.includes("compressed") || mimetype.includes("rar")) return <div className={`${wrapperClass} bg-amber-500/15 text-amber-300`}><Archive className={iconClass} /></div>;
  if (mimetype.includes("word") || mimetype.includes("document") || mimetype.includes("text")) return <div className={`${wrapperClass} bg-blue-500/15 text-blue-300`}><FileText className={iconClass} /></div>;
  return <div className={`${wrapperClass} bg-slate-500/15 text-slate-300`}><File className={iconClass} /></div>;
}

export default function DashboardPage() {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("recent");
  const [profileOpen, setProfileOpen] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const { data: dashboard, isLoading } = useQuery<{ files: FileType[] }>({
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
  const visibleFiles = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = files.filter((file) => {
      if (file.status !== "uploaded" || file.folderId !== null) return false;
      if (normalizedSearch && !file.filename.toLowerCase().includes(normalizedSearch)) return false;
      if (typeFilter === "images") return file.mimetype.startsWith("image/");
      if (typeFilter === "videos") return file.mimetype.startsWith("video/");
      if (typeFilter === "documents") return file.mimetype.includes("pdf") || file.mimetype.includes("document") || file.mimetype.includes("word");
      if (typeFilter === "archives") return file.mimetype.includes("zip") || file.mimetype.includes("compressed") || file.mimetype.includes("rar");
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortOrder === "name") return a.filename.localeCompare(b.filename);
      if (sortOrder === "size") return b.size - a.size;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [files, search, sortOrder, typeFilter]);

  const handleLogout = async () => {
    await fetch("/api/auth/signout");
    router.push("/sign_in");
  };

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#0b1220_0%,#111827_100%)] px-4 py-5 text-slate-100 sm:px-8 sm:py-8">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex items-center justify-between border-b border-slate-700/70 pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-lg font-bold text-white shadow-lg shadow-indigo-950/30">S</div>
            <h1 className="text-xl font-semibold tracking-tight text-white">StoreIt</h1>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              className="flex h-10 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-3 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
              aria-expanded={profileOpen}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-200">U</span>
              <span className="hidden sm:inline">Profile</span>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-12 z-30 w-44 rounded-xl border border-slate-700 bg-[#111827] p-1.5 shadow-2xl shadow-black/30">
                <button type="button" onClick={handleLogout} className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-300 transition hover:bg-red-500/10 hover:text-red-200">Log out</button>
              </div>
            )}
          </div>
        </header>

        <section className="mx-auto max-w-4xl py-8">
          <h2 className="text-3xl font-bold tracking-tight text-white">Storage</h2>
          <p className="mt-2 text-base text-slate-400">Upload, organize, and share your files from one place.</p>
        </section>

        <section className="mx-auto grid max-w-4xl gap-3 border-y border-slate-700/70 py-5 lg:grid-cols-[minmax(320px,1fr)_160px_160px]">
          <label className="flex h-11 items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/70 px-3 text-slate-400 transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-400/20">
            <Search className="h-5 w-5" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500" placeholder="Search files..." />
          </label>
          <label className="relative">
            <span className="sr-only">Filter files</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="h-11 w-full appearance-none rounded-xl border border-slate-700 bg-slate-900/70 px-3 pr-9 text-sm text-slate-200 outline-none transition hover:border-slate-600 focus:border-indigo-400">
              <option value="all">All files</option>
              <option value="images">Images</option>
              <option value="videos">Videos</option>
              <option value="documents">Documents</option>
              <option value="archives">Archives</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
          </label>
          <label className="relative">
            <span className="sr-only">Sort files</span>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="h-11 w-full appearance-none rounded-xl border border-slate-700 bg-slate-900/70 px-3 pr-9 text-sm text-slate-200 outline-none transition hover:border-slate-600 focus:border-indigo-400">
              <option value="recent">Recently uploaded</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
          </label>
        </section>

        <section className="mx-auto max-w-4xl py-8">
          <FileUpload currentFolderId={null} />
        </section>

        <section className="mx-auto max-w-4xl pb-8">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <p className="text-sm font-medium text-indigo-300">Recently uploaded</p>
              <h2 className="mt-1 text-xl font-semibold text-white">Files ({visibleFiles.length})</h2>
            </div>
            <button type="button" onClick={() => router.push("/all-files")} className="text-sm font-medium text-indigo-300 transition hover:text-indigo-200">View all</button>
          </div>

          {isLoading ? (
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-6 text-sm text-slate-400">Loading files...</div>
          ) : visibleFiles.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-600 bg-slate-900/40 py-16 text-center">
              <Folder className="mx-auto h-10 w-10 text-slate-500" />
              <p className="mt-3 text-sm text-slate-400">No files match your current filters.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleFiles.map((file) => (
                <article key={file._id} className="group flex min-h-[76px] flex-col gap-4 rounded-xl border border-slate-700 bg-[#111827] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-400/60 hover:shadow-lg hover:shadow-indigo-950/20 sm:flex-row sm:items-center">
                  <FileTypeIcon mimetype={file.mimetype} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold text-slate-100">{file.filename}</h3>
                    <p className="mt-1 text-sm text-slate-400">{formatBytes(file.size)} <span className="px-1.5 text-slate-600">•</span> {formatDate(file.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2 sm:ml-auto">
                    <button type="button" className="rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-400">Open</button>
                    <button type="button" aria-label={`Download ${file.filename}`} className="rounded-lg p-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"><Download className="h-4 w-4" /></button>
                    <button type="button" aria-label={`Share ${file.filename}`} className="rounded-lg p-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"><Share2 className="h-4 w-4" /></button>
                    <button type="button" aria-label={`More actions for ${file.filename}`} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ file, x: rect.right - 176, y: rect.bottom + 8 }); }} className="rounded-lg p-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"><MoreHorizontal className="h-5 w-5" /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {menu && (
        <div className="fixed z-50 w-44 rounded-xl border border-slate-700 bg-[#111827] p-1.5 shadow-2xl shadow-black/40" style={{ left: Math.max(12, menu.x), top: menu.y }} onClick={(event) => event.stopPropagation()}>
          {['Open', 'Download', 'Share', 'Rename', 'Delete'].map((action) => <button key={action} type="button" onClick={() => setMenu(null)} className={`w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-slate-800 ${action === 'Delete' ? 'text-red-300 hover:bg-red-500/10' : 'text-slate-200'}`}>{action}</button>)}
        </div>
      )}
    </main>
  );
}
