"use client";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/client/lib/apiClient";
import { useAuth } from "@/components/AuthProvider";
import RequireAuth from "@/components/RequireAuth";

type FileType = {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  storageUrl: string;
  owner_id: string;
  status: string;
  backend: "s3" | "telegram";
  folderId: string | null;
  createdAt: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getMimeIcon(mime: string): string {
  if (mime.startsWith("image/")) return "🖼";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime.includes("pdf"))      return "📄";
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) return "🗜";
  if (mime.includes("word") || mime.includes("document"))  return "📝";
  if (mime.includes("sheet") || mime.includes("excel"))    return "📊";
  return "📁";
}

export default function AllFilesPage() {
  return (
    <RequireAuth>
      <AllFilesPageInner />
    </RequireAuth>
  );
}

function AllFilesPageInner() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [search, setSearch] = useState("");

  const { data: files = [], isLoading } = useQuery<FileType[]>({
    queryKey: ["all-files"],
    queryFn: async () => {
      const res = await apiClient("/api/files/fetch?status=uploaded&limit=500");
      if (!res.ok) throw new Error("Failed to fetch files");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const visible = files.filter((f) =>
    f.filename.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .af-root {
          --bg: #080a0f; --surface: #0e1118; --surface2: #141820;
          --surface3: #1c2130; --border: #1e2535; --border-light: #252e42;
          --text: #dde2f0; --text-muted: #5a6480; --text-dim: #8892aa;
          font-family: 'DM Sans', sans-serif;
          background: var(--bg); min-height: 100vh; color: var(--text);
        }
        .af-topbar {
          padding: 16px 28px; border-bottom: 1px solid var(--border);
          display: flex; align-items: center; gap: 16px;
          background: rgba(8,10,15,0.85); backdrop-filter: blur(12px);
          position: sticky; top: 0; z-index: 100;
        }
        .af-back-btn {
          display: flex; align-items: center; gap: 6px;
          background: var(--surface2); border: 1px solid var(--border-light);
          color: var(--text-dim); font-family: 'DM Sans', sans-serif;
          font-size: 0.78rem; font-weight: 500; padding: 6px 12px;
          border-radius: 8px; cursor: pointer; transition: all 0.15s;
        }
        .af-back-btn:hover { color: var(--text); border-color: #2e3a52; background: var(--surface3); }
        .af-title { font-size: 1rem; font-weight: 700; color: var(--text); }
        .af-search {
          margin-left: auto; display: flex; align-items: center; gap: 8px;
          background: var(--surface2); border: 1px solid var(--border-light);
          border-radius: 10px; padding: 7px 14px;
        }
        .af-search input {
          background: none; border: none; outline: none; color: var(--text);
          font-family: 'DM Sans', sans-serif; font-size: 0.82rem; width: 200px;
        }
        .af-search input::placeholder { color: var(--text-muted); }
        .af-body { max-width: 960px; margin: 0 auto; padding: 28px 24px; }
        .af-count { font-size: 0.82rem; color: var(--text-muted); margin-bottom: 16px; }
        .af-list { display: flex; flex-direction: column; gap: 6px; }
        .af-row {
          display: flex; align-items: center; gap: 14px;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 11px; padding: 11px 16px; transition: all 0.15s;
        }
        .af-row:hover { border-color: var(--border-light); background: var(--surface2); }
        .af-icon {
          width: 36px; height: 36px; border-radius: 9px;
          background: var(--surface2); border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; flex-shrink: 0;
        }
        .af-info { flex: 1; overflow: hidden; }
        .af-name { font-size: 0.83rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .af-meta { font-size: 0.69rem; color: var(--text-muted); margin-top: 2px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .af-badge {
          font-size: 0.6rem; font-weight: 600; padding: 2px 7px; border-radius: 99px;
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .af-badge.s3 { background: rgba(108,142,255,0.12); color: #6c8eff; border: 1px solid rgba(108,142,255,0.2); }
        .af-badge.telegram { background: rgba(52,211,153,0.12); color: #34d399; border: 1px solid rgba(52,211,153,0.2); }
        .af-actions { display: flex; gap: 5px; flex-shrink: 0; }
        .af-btn {
          background: var(--surface2); border: 1px solid var(--border);
          color: var(--text-muted); font-size: 0.72rem; font-weight: 500;
          padding: 5px 10px; border-radius: 7px; cursor: pointer; transition: all 0.15s;
          font-family: 'DM Sans', sans-serif; white-space: nowrap;
        }
        .af-btn:hover { background: var(--surface3); border-color: var(--border-light); color: var(--text); }
        .af-btn.open { color: #6c8eff; border-color: rgba(108,142,255,0.2); }
        .af-btn.open:hover { background: rgba(108,142,255,0.08); }
        .af-skeleton {
          height: 56px; border-radius: 11px;
          background: linear-gradient(90deg, var(--surface) 25%, var(--surface2) 50%, var(--surface) 75%);
          background-size: 200% 100%; animation: shimmer 1.4s infinite;
        }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .af-empty { text-align: center; padding: 80px 0; color: var(--text-muted); font-size: 0.85rem; }
        .af-empty-icon { font-size: 2rem; margin-bottom: 12px; opacity: 0.4; }
      `}</style>

      <div className="af-root">
        <header className="af-topbar">
          <button className="af-back-btn" onClick={() => router.push("/dashboard")}>
            ← Back
          </button>
          <div className="af-title">All Files</div>
          <div className="af-search">
            <span style={{ color: "var(--text-muted)", fontSize: 14 }}>⌕</span>
            <input
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </header>

        <div className="af-body">
          <div className="af-count">
            {isLoading ? "Loading…" : `${visible.length} file${visible.length !== 1 ? "s" : ""}${search ? ` matching "${search}"` : ""}`}
          </div>

          {isLoading ? (
            <div className="af-list">
              {[...Array(6)].map((_, i) => <div key={i} className="af-skeleton" />)}
            </div>
          ) : visible.length === 0 ? (
            <div className="af-empty">
              <div className="af-empty-icon">📂</div>
              <div>{search ? `No files matching "${search}"` : "No files uploaded yet"}</div>
            </div>
          ) : (
            <div className="af-list">
              {visible.map((file) => (
                <div key={file._id} className="af-row">
                  <div className="af-icon">{getMimeIcon(file.mimetype)}</div>
                  <div className="af-info">
                    <div className="af-name">{file.filename}</div>
                    <div className="af-meta">
                      <span>{formatBytes(file.size)}</span>
                      <span>{formatDate(file.createdAt)}</span>
                      <span className={`af-badge ${file.backend}`}>{file.backend}</span>
                    </div>
                  </div>
                  <div className="af-actions">
                    <button
                      className="af-btn open"
                      onClick={() => window.open(`/api/files/${file._id}/download`, "_blank")}
                    >
                      Open
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
