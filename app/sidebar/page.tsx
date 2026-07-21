"use client";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/client/lib/apiClient";
import { useAuth } from "@/components/AuthProvider";
import RequireAuth from "@/components/RequireAuth";

// ── Types ────────────────────────────────────────────────────────────────────
type FileType = {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  storageUrl: string;
  owner_id: string;
  status: "pending" | "uploaded";
  folderId: string | null;
  createdAt: string;
};

type Category = {
  id: string;
  label: string;
  icon: string;
  color: string;
  glow: string;
  match: (mime: string) => boolean;
};

// ── Categories ───────────────────────────────────────────────────────────────
const CATEGORIES: Category[] = [
  {
    id: "all",
    label: "All files",
    icon: "◈",
    color: "#6c8eff",
    glow: "rgba(108,142,255,0.15)",
    match: () => true,
  },
  {
    id: "images",
    label: "Images",
    icon: "▣",
    color: "#f472b6",
    glow: "rgba(244,114,182,0.15)",
    match: (m) => m.startsWith("image/"),
  },
  {
    id: "videos",
    label: "Videos",
    icon: "▶",
    color: "#fb923c",
    glow: "rgba(251,146,60,0.15)",
    match: (m) => m.startsWith("video/"),
  },
  {
    id: "audio",
    label: "Audio",
    icon: "♪",
    color: "#a78bfa",
    glow: "rgba(167,139,250,0.15)",
    match: (m) => m.startsWith("audio/"),
  },
  {
    id: "pdfs",
    label: "PDFs",
    icon: "◉",
    color: "#f87171",
    glow: "rgba(248,113,113,0.15)",
    match: (m) => m.includes("pdf"),
  },
  {
    id: "docs",
    label: "Documents",
    icon: "☰",
    color: "#34d399",
    glow: "rgba(52,211,153,0.15)",
    match: (m) => m.includes("word") || m.includes("document") || m.includes("text/plain"),
  },
  {
    id: "sheets",
    label: "Spreadsheets",
    icon: "⊞",
    color: "#4ade80",
    glow: "rgba(74,222,128,0.15)",
    match: (m) => m.includes("sheet") || m.includes("excel") || m.includes("csv"),
  },
  {
    id: "archives",
    label: "Archives",
    icon: "⊟",
    color: "#fbbf24",
    glow: "rgba(251,191,36,0.15)",
    match: (m) => m.includes("zip") || m.includes("compressed") || m.includes("tar") || m.includes("rar"),
  },
  {
    id: "other",
    label: "Other",
    icon: "○",
    color: "#9ca3af",
    glow: "rgba(156,163,175,0.12)",
    match: (m) =>
      !m.startsWith("image/") &&
      !m.startsWith("video/") &&
      !m.startsWith("audio/") &&
      !m.includes("pdf") &&
      !m.includes("word") &&
      !m.includes("document") &&
      !m.includes("text/plain") &&
      !m.includes("sheet") &&
      !m.includes("excel") &&
      !m.includes("csv") &&
      !m.includes("zip") &&
      !m.includes("compressed") &&
      !m.includes("tar") &&
      !m.includes("rar"),
  },
];

// ── Utils ────────────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Component ────────────────────────────────────────────────────────────────
export default function ShowFilesPage() {
  return (
    <RequireAuth>
      <ShowFilesPageInner />
    </RequireAuth>
  );
}

function ShowFilesPageInner() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [activeId, setActiveId]   = useState("all");
  const [search, setSearch]       = useState("");
  const [shareUrl, setShareUrl]   = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [shareFile, setShareFile] = useState<FileType | null>(null);
  const [toast, setToast]         = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [previewFile, setPreviewFile] = useState<FileType | null>(null);
  const [previewUrl, setPreviewUrl]   = useState("");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const { data: files = [], isLoading } = useQuery<FileType[]>({
    queryKey: ["files"],
    queryFn: async () => {
      const res = await apiClient("/api/files/fetch");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const uploaded = files.filter((f) => f.status === "uploaded");

  const activeCategory = CATEGORIES.find((c) => c.id === activeId) ?? CATEGORIES[0];

  const visible = uploaded.filter((f) => {
    const matchCat = activeCategory.match(f.mimetype);
    const matchSearch = f.filename.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const getFileUrl = async (key: string): Promise<string> => {
    const res = await apiClient("/api/files/fetch/url", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error("Failed to get URL");
    return (await res.json()).url;
  };

  const openPreview = async (file: FileType) => {
    setPreviewFile(file); setPreviewUrl("");
    const url = await getFileUrl(file.storageUrl).catch(() => "");
    setPreviewUrl(url);
  };

  const downloadFile = async (file: FileType) => {
    try {
      const url = await getFileUrl(file.storageUrl);
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl; a.download = file.filename; a.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch { setToast({ msg: "Download failed.", type: "error" }); }
  };

  const openShare = async (file: FileType) => {
    setShareFile(file); setShareUrl(""); setShareCopied(false);
    try {
      const res = await apiClient(`/api/files/${file._id}/share`, { method: "POST" });
      if (!res.ok) throw new Error();
      const { shareUrl: url } = await res.json();
      setShareUrl(url);
    } catch { setToast({ msg: "Could not generate share link.", type: "error" }); setShareFile(null); }
  };

  const copyShare = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2500);
  };

  const isImage = (mime: string) => mime.startsWith("image/");
  const isVideo = (mime: string) => mime.startsWith("video/");
  const isAudio = (mime: string) => mime.startsWith("audio/");

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .sf-root {
          --bg: #080a0f;
          --surface: #0e1118;
          --surface2: #141820;
          --surface3: #1c2130;
          --border: #1e2535;
          --border-light: #252e42;
          --text: #dde2f0;
          --text-muted: #5a6480;
          --text-dim: #8892aa;
          font-family: 'DM Sans', sans-serif;
          background: var(--bg); min-height: 100vh; color: var(--text);
          display: flex; flex-direction: column;
        }

        /* ── Top bar ── */
        .sf-topbar {
          padding: 16px 28px; border-bottom: 1px solid var(--border);
          display: flex; align-items: center; gap: 16px;
          background: rgba(8,10,15,0.85); backdrop-filter: blur(12px);
          position: sticky; top: 0; z-index: 100;
        }
        .sf-back-btn {
          display: flex; align-items: center; gap: 6px;
          background: var(--surface2); border: 1px solid var(--border-light);
          color: var(--text-dim); font-family: 'DM Sans', sans-serif;
          font-size: 0.78rem; font-weight: 500; padding: 6px 12px;
          border-radius: 8px; cursor: pointer; transition: all 0.15s;
        }
        .sf-back-btn:hover { color: var(--text); border-color: #2e3a52; background: var(--surface3); }
        .sf-topbar-title {
          font-family: 'Syne', sans-serif; font-size: 1rem; font-weight: 700;
          color: var(--text); letter-spacing: -0.02em;
        }
        .sf-search {
          margin-left: auto; display: flex; align-items: center; gap: 8px;
          background: var(--surface2); border: 1px solid var(--border-light);
          border-radius: 10px; padding: 7px 14px;
        }
        .sf-search input {
          background: none; border: none; outline: none; color: var(--text);
          font-family: 'DM Sans', sans-serif; font-size: 0.82rem; width: 200px;
        }
        .sf-search input::placeholder { color: var(--text-muted); }

        /* ── Body ── */
        .sf-body { display: flex; flex: 1; overflow: hidden; }

        /* ── Sidebar ── */
        .sf-sidebar {
          width: 220px; flex-shrink: 0;
          border-right: 1px solid var(--border);
          padding: 24px 12px; display: flex; flex-direction: column; gap: 2px;
          overflow-y: auto;
        }
        .sf-sidebar-label {
          font-family: 'DM Mono', monospace;
          font-size: 0.62rem; font-weight: 500; letter-spacing: 0.12em;
          text-transform: uppercase; color: var(--text-muted);
          padding: 0 10px; margin-bottom: 8px; margin-top: 4px;
        }
        .sf-nav-item {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 12px; border-radius: 10px; cursor: pointer;
          border: 1px solid transparent; background: none;
          font-family: 'DM Sans', sans-serif; font-size: 0.83rem;
          color: var(--text-dim); transition: all 0.15s; width: 100%; text-align: left;
          position: relative;
        }
        .sf-nav-item:hover { background: var(--surface2); color: var(--text); border-color: var(--border); }
        .sf-nav-item.active { background: var(--surface3); border-color: var(--border-light); color: var(--text); }
        .sf-nav-icon {
          width: 28px; height: 28px; border-radius: 7px;
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-family: 'DM Mono', monospace; flex-shrink: 0;
          background: var(--surface3); transition: all 0.15s;
        }
        .sf-nav-item.active .sf-nav-icon { background: var(--surface3); }
        .sf-nav-label { flex: 1; }
        .sf-nav-count {
          font-family: 'DM Mono', monospace;
          font-size: 0.68rem; color: var(--text-muted);
          background: var(--surface3); border: 1px solid var(--border);
          padding: 1px 7px; border-radius: 99px;
        }
        .sf-nav-item.active .sf-nav-count { color: var(--text-dim); }
        .sf-sidebar-divider { height: 1px; background: var(--border); margin: 10px 4px; }

        /* Storage summary */
        .sf-storage-bar {
          margin-top: auto; padding: 16px 12px 8px;
        }
        .sf-storage-label { font-size: 0.72rem; color: var(--text-muted); margin-bottom: 6px; display: flex; justify-content: space-between; }
        .sf-bar-bg { height: 3px; background: var(--surface3); border-radius: 99px; overflow: hidden; }
        .sf-bar-fill { height: 100%; border-radius: 99px; background: linear-gradient(90deg, #6c8eff, #a78bfa); }

        /* ── Main ── */
        .sf-main { flex: 1; overflow-y: auto; padding: 28px 32px; }

        /* Header row */
        .sf-main-header {
          display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 24px;
        }
        .sf-main-title {
          display: flex; align-items: center; gap: 12px;
        }
        .sf-main-icon {
          width: 42px; height: 42px; border-radius: 11px;
          display: flex; align-items: center; justify-content: center;
          font-family: 'DM Mono', monospace; font-size: 17px;
        }
        .sf-main-name {
          font-family: 'Syne', sans-serif; font-size: 1.4rem; font-weight: 800;
          letter-spacing: -0.03em;
        }
        .sf-main-count { font-size: 0.8rem; color: var(--text-muted); margin-top: 2px; }
        .sf-view-toggle { display: flex; gap: 4px; }
        .sf-vbtn {
          background: var(--surface2); border: 1px solid var(--border);
          color: var(--text-muted); padding: 6px 10px; border-radius: 7px;
          cursor: pointer; font-size: 14px; transition: all 0.15s;
        }
        .sf-vbtn.active { background: var(--surface3); border-color: var(--border-light); color: var(--text); }

        /* ── Grid view ── */
        .sf-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 12px;
        }
        .sf-grid-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 14px; overflow: hidden; cursor: pointer;
          transition: all 0.18s; position: relative;
        }
        .sf-grid-card:hover { border-color: var(--border-light); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
        .sf-grid-thumb {
          height: 120px; display: flex; align-items: center; justify-content: center;
          background: var(--surface2); font-size: 36px; overflow: hidden; position: relative;
        }
        .sf-grid-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .sf-grid-thumb-icon { font-size: 36px; opacity: 0.6; }
        .sf-grid-info { padding: 10px 12px; }
        .sf-grid-name { font-size: 0.78rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
        .sf-grid-meta { font-size: 0.67rem; color: var(--text-muted); margin-top: 3px; }
        .sf-grid-actions {
          position: absolute; top: 6px; right: 6px;
          display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s;
        }
        .sf-grid-card:hover .sf-grid-actions { opacity: 1; }
        .sf-grid-action-btn {
          background: rgba(8,10,15,0.85); backdrop-filter: blur(8px);
          border: 1px solid var(--border-light); color: var(--text-dim);
          padding: 4px 8px; border-radius: 6px; cursor: pointer;
          font-size: 0.7rem; font-weight: 500; transition: all 0.12s;
          font-family: 'DM Sans', sans-serif;
        }
        .sf-grid-action-btn:hover { color: var(--text); background: rgba(30,37,53,0.95); }

        /* ── List view ── */
        .sf-list { display: flex; flex-direction: column; gap: 6px; }
        .sf-list-row {
          display: flex; align-items: center; gap: 14px;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 11px; padding: 11px 16px; transition: all 0.15s; cursor: pointer;
        }
        .sf-list-row:hover { border-color: var(--border-light); background: var(--surface2); }
        .sf-list-icon {
          width: 36px; height: 36px; border-radius: 9px;
          background: var(--surface2); border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; flex-shrink: 0; overflow: hidden;
        }
        .sf-list-icon img { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; }
        .sf-list-info { flex: 1; overflow: hidden; }
        .sf-list-name { font-size: 0.83rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sf-list-meta { font-size: 0.69rem; color: var(--text-muted); margin-top: 2px; display: flex; gap: 10px; }
        .sf-list-size { font-family: 'DM Mono', monospace; }
        .sf-list-actions { display: flex; gap: 5px; flex-shrink: 0; }
        .sf-list-btn {
          background: var(--surface2); border: 1px solid var(--border);
          color: var(--text-muted); font-size: 0.72rem; font-weight: 500;
          padding: 5px 10px; border-radius: 7px; cursor: pointer; transition: all 0.15s;
          font-family: 'DM Sans', sans-serif; white-space: nowrap;
        }
        .sf-list-btn:hover { background: var(--surface3); border-color: var(--border-light); color: var(--text); }
        .sf-list-btn.open  { color: #6c8eff; border-color: rgba(108,142,255,0.2); }
        .sf-list-btn.share { color: #34d399; border-color: rgba(52,211,153,0.2); }
        .sf-list-btn.open:hover  { background: rgba(108,142,255,0.08); }
        .sf-list-btn.share:hover { background: rgba(52,211,153,0.08); }

        /* ── Empty ── */
        .sf-empty {
          grid-column: 1/-1; text-align: center; padding: 80px 0;
          display: flex; flex-direction: column; align-items: center; gap: 12px;
        }
        .sf-empty-icon {
          width: 64px; height: 64px; border-radius: 16px;
          background: var(--surface2); border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          font-family: 'DM Mono', monospace; font-size: 24px; color: var(--text-muted);
        }
        .sf-empty-title { font-family: 'Syne', sans-serif; font-size: 0.95rem; font-weight: 700; color: var(--text-dim); }
        .sf-empty-sub { font-size: 0.78rem; color: var(--text-muted); }

        /* Skeleton */
        .sf-skeleton {
          height: 56px; border-radius: 11px;
          background: linear-gradient(90deg, var(--surface) 25%, var(--surface2) 50%, var(--surface) 75%);
          background-size: 200% 100%; animation: shimmer 1.4s infinite;
        }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        /* ── Preview modal ── */
        .sf-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center; z-index: 500;
          animation: fadeIn 0.15s ease;
        }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        .sf-preview-modal {
          background: var(--surface); border: 1px solid var(--border-light);
          border-radius: 20px; padding: 24px; width: 90%; max-width: 720px; max-height: 85vh;
          display: flex; flex-direction: column; gap: 16px;
          animation: slideUp 0.2s ease;
        }
        @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .sf-preview-header { display: flex; align-items: center; gap: 12px; }
        .sf-preview-name { font-family: 'Syne', sans-serif; font-size: 0.95rem; font-weight: 700; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sf-preview-close {
          background: var(--surface2); border: 1px solid var(--border-light);
          color: var(--text-dim); width: 32px; height: 32px; border-radius: 8px;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          font-size: 16px; transition: all 0.15s; flex-shrink: 0;
        }
        .sf-preview-close:hover { color: var(--text); background: var(--surface3); }
        .sf-preview-body { flex: 1; overflow: auto; border-radius: 12px; background: var(--surface2); min-height: 200px; display: flex; align-items: center; justify-content: center; }
        .sf-preview-body img { max-width: 100%; max-height: 60vh; border-radius: 12px; display: block; }
        .sf-preview-body video, .sf-preview-body audio { width: 100%; border-radius: 12px; }
        .sf-preview-loading { color: var(--text-muted); font-size: 0.82rem; }
        .sf-preview-unsupported { color: var(--text-muted); font-size: 0.82rem; text-align: center; padding: 32px; }
        .sf-preview-actions { display: flex; gap: 8px; }
        .sf-preview-btn {
          flex: 1; padding: 9px; border-radius: 9px;
          font-family: 'DM Sans', sans-serif; font-size: 0.83rem; font-weight: 500;
          cursor: pointer; transition: all 0.15s; border: 1px solid var(--border-light);
          background: var(--surface2); color: var(--text-dim);
        }
        .sf-preview-btn:hover { color: var(--text); background: var(--surface3); }
        .sf-preview-btn.accent { background: rgba(108,142,255,0.1); border-color: rgba(108,142,255,0.3); color: #6c8eff; }
        .sf-preview-btn.accent:hover { background: rgba(108,142,255,0.2); }

        /* Share modal */
        .sf-share-modal {
          background: var(--surface); border: 1px solid var(--border-light);
          border-radius: 18px; padding: 26px; width: 90%; max-width: 380px;
          animation: slideUp 0.2s ease;
        }
        .sf-share-title { font-family: 'Syne', sans-serif; font-size: 1rem; font-weight: 700; margin-bottom: 6px; }
        .sf-share-sub { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 18px; }
        .sf-share-url-wrap {
          display: flex; gap: 6px; background: var(--surface2);
          border: 1px solid var(--border-light); border-radius: 10px; padding: 10px 12px;
        }
        .sf-share-url-input {
          flex: 1; background: none; border: none; outline: none;
          font-size: 0.75rem; color: var(--text-dim);
          font-family: 'DM Mono', monospace; white-space: nowrap; overflow: hidden;
        }
        .sf-copy-btn {
          background: rgba(108,142,255,0.12); border: 1px solid rgba(108,142,255,0.25);
          color: #6c8eff; font-size: 0.73rem; font-weight: 500;
          padding: 4px 10px; border-radius: 7px; cursor: pointer; flex-shrink: 0;
          font-family: 'DM Sans', sans-serif; transition: all 0.15s;
        }
        .sf-copy-btn.copied { background: rgba(52,211,153,0.12); border-color: rgba(52,211,153,0.3); color: #34d399; }
        .sf-share-close-btn {
          width: 100%; margin-top: 14px; padding: 9px; border-radius: 9px;
          background: var(--surface2); border: 1px solid var(--border-light);
          color: var(--text-dim); font-family: 'DM Sans', sans-serif;
          font-size: 0.83rem; cursor: pointer; transition: all 0.15s;
        }
        .sf-share-close-btn:hover { color: var(--text); background: var(--surface3); }

        /* Toast */
        .sf-toast {
          position: fixed; bottom: 24px; right: 24px;
          background: var(--surface2); border: 1px solid var(--border-light);
          border-radius: 12px; padding: 11px 16px; font-size: 0.8rem; font-weight: 500;
          display: flex; align-items: center; gap: 8px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5); z-index: 999; max-width: 300px;
          animation: slideUp 0.2s ease;
        }
        .sf-toast.success { border-color: rgba(52,211,153,0.3); color: #34d399; }
        .sf-toast.error   { border-color: rgba(248,113,113,0.3); color: #f87171; }
      `}</style>

      <div className="sf-root">
        {/* ── Top bar ── */}
        <header className="sf-topbar">
          <button className="sf-back-btn" onClick={() => router.push("/dashboard")}>
            ← Back
          </button>
          <div className="sf-topbar-title">Browse files</div>
          <div className="sf-search">
            <span style={{ color: "var(--text-muted)", fontSize: 14 }}>⌕</span>
            <input
              placeholder="Search files…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </header>

        <div className="sf-body">
          {/* ── Sidebar ── */}
          <aside className="sf-sidebar">
            <div className="sf-sidebar-label">File types</div>

            {CATEGORIES.map((cat) => {
              const count = cat.id === "all"
                ? uploaded.length
                : uploaded.filter((f) => cat.match(f.mimetype)).length;
              const isActive = activeId === cat.id;
              return (
                <button
                  key={cat.id}
                  className={`sf-nav-item ${isActive ? "active" : ""}`}
                  onClick={() => setActiveId(cat.id)}
                >
                  <div
                    className="sf-nav-icon"
                    style={isActive ? { color: cat.color, background: cat.glow, border: `1px solid ${cat.color}30` } : {}}
                  >
                    {cat.icon}
                  </div>
                  <span className="sf-nav-label">{cat.label}</span>
                  {count > 0 && <span className="sf-nav-count">{count}</span>}
                </button>
              );
            })}

            <div className="sf-sidebar-divider" />

            {/* Storage summary */}
            <div className="sf-storage-bar">
              <div className="sf-storage-label">
                <span>Storage</span>
                <span>{formatBytes(uploaded.reduce((a, f) => a + f.size, 0))}</span>
              </div>
              <div className="sf-bar-bg">
                <div className="sf-bar-fill" style={{ width: "42%" }} />
              </div>
            </div>
          </aside>

          {/* ── Main ── */}
          <main className="sf-main">
            {/* Header */}
            <div className="sf-main-header">
              <div className="sf-main-title">
                <div
                  className="sf-main-icon"
                  style={{ color: activeCategory.color, background: activeCategory.glow, border: `1px solid ${activeCategory.color}25` }}
                >
                  {activeCategory.icon}
                </div>
                <div>
                  <div className="sf-main-name" style={{ color: activeCategory.color }}>
                    {activeCategory.label}
                  </div>
                  <div className="sf-main-count">
                    {visible.length} file{visible.length !== 1 ? "s" : ""}
                    {search && ` matching "${search}"`}
                  </div>
                </div>
              </div>
            </div>

            {/* File list */}
            {isLoading ? (
              <div className="sf-list">
                {[...Array(5)].map((_, i) => <div key={i} className="sf-skeleton" />)}
              </div>
            ) : visible.length === 0 ? (
              <div className="sf-list">
                <div className="sf-empty">
                  <div className="sf-empty-icon">{activeCategory.icon}</div>
                  <div className="sf-empty-title">No {activeCategory.label.toLowerCase()} found</div>
                  <div className="sf-empty-sub">
                    {search ? `No results for "${search}"` : "Upload some files to see them here"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="sf-list">
                {visible.map((file) => (
                  <div key={file._id} className="sf-list-row" onClick={() => openPreview(file)}>
                    <div className="sf-list-icon">
                      {isImage(file.mimetype)
                        ? <ImgThumb storageUrl={file.storageUrl} getFileUrl={getFileUrl} />
                        : <span>{getMimeIcon(file.mimetype)}</span>}
                    </div>
                    <div className="sf-list-info">
                      <div className="sf-list-name">{file.filename}</div>
                      <div className="sf-list-meta">
                        <span className="sf-list-size">{formatBytes(file.size)}</span>
                        <span>{formatDate(file.createdAt)}</span>
                        <span style={{ color: "var(--text-muted)", fontFamily: "'DM Mono', monospace", fontSize: "0.65rem" }}>
                          {file.mimetype}
                        </span>
                      </div>
                    </div>
                    <div className="sf-list-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="sf-list-btn open" onClick={() => openPreview(file)}>Preview</button>
                      <button className="sf-list-btn share" onClick={() => openShare(file)}>Share</button>
                      <button className="sf-list-btn" onClick={() => downloadFile(file)}>⬇</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* ── Preview modal ── */}
      {previewFile && (
        <div className="sf-overlay" onClick={() => setPreviewFile(null)}>
          <div className="sf-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sf-preview-header">
              <span style={{ fontSize: 20 }}>{getMimeIcon(previewFile.mimetype)}</span>
              <div className="sf-preview-name">{previewFile.filename}</div>
              <button className="sf-preview-close" onClick={() => setPreviewFile(null)}>✕</button>
            </div>

            <div className="sf-preview-body">
              {!previewUrl ? (
                <div className="sf-preview-loading">Loading preview…</div>
              ) : isImage(previewFile.mimetype) ? (
                <img src={previewUrl} alt={previewFile.filename} />
              ) : isVideo(previewFile.mimetype) ? (
                <video src={previewUrl} controls />
              ) : isAudio(previewFile.mimetype) ? (
                <audio src={previewUrl} controls />
              ) : (
                <div className="sf-preview-unsupported">
                  <div style={{ fontSize: 40, marginBottom: 12 }}>{getMimeIcon(previewFile.mimetype)}</div>
                  <div>Preview not available for this file type.</div>
                  <div style={{ fontSize: "0.72rem", marginTop: 6, color: "var(--text-muted)" }}>{previewFile.mimetype}</div>
                </div>
              )}
            </div>

            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "flex", gap: 16 }}>
              <span>{formatBytes(previewFile.size)}</span>
              <span>{formatDate(previewFile.createdAt)}</span>
            </div>

            <div className="sf-preview-actions">
              <button className="sf-preview-btn" onClick={() => downloadFile(previewFile)}>⬇ Download</button>
              <button className="sf-preview-btn accent" onClick={() => { openShare(previewFile); setPreviewFile(null); }}>🔗 Share</button>
              <button className="sf-preview-btn" onClick={() => previewUrl && window.open(previewUrl, "_blank")}>↗ Open</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Share modal ── */}
      {shareFile && (
        <div className="sf-overlay" onClick={() => setShareFile(null)}>
          <div className="sf-share-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sf-share-title">🔗 Share file</div>
            <div className="sf-share-sub">Anyone with this link can view &quot;{shareFile.filename}&quot;</div>
            {shareUrl ? (
              <div className="sf-share-url-wrap">
                <input className="sf-share-url-input" readOnly value={shareUrl} />
                <button className={`sf-copy-btn ${shareCopied ? "copied" : ""}`} onClick={copyShare}>
                  {shareCopied ? "✓ Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Generating link…</div>
            )}
            <button className="sf-share-close-btn" onClick={() => setShareFile(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className={`sf-toast ${toast.type}`}>
          {toast.type === "success" ? "✓" : "✕"} {toast.msg}
        </div>
      )}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Lazy image thumbnail — fetches presigned URL on mount */
function ImgThumb({ storageUrl, getFileUrl }: { storageUrl: string; getFileUrl: (k: string) => Promise<string> }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    getFileUrl(storageUrl).then(setUrl).catch(() => {});
  }, [storageUrl]);
  return url ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} /> : <span>🖼</span>;
}

function getMimeIcon(mime: string): string {
  if (mime.startsWith("image/")) return "🖼";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime.includes("pdf"))      return "📄";
  if (mime.includes("zip") || mime.includes("compressed")) return "🗜";
  if (mime.includes("word") || mime.includes("document"))  return "📝";
  if (mime.includes("sheet") || mime.includes("excel"))    return "📊";
  return "📁";
}
