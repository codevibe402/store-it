"use client";
import { useState, useEffect, useRef } from "react";

type SearchResult = {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  storageUrl: string;
  folderId: string | null;
  createdAt: string;
  matchedContent?: boolean;
  snippet?: string;
};

function getFileIcon(mimetype: string): string {
  if (mimetype.startsWith("image/")) return "🖼️";
  if (mimetype.startsWith("video/")) return "🎬";
  if (mimetype.startsWith("audio/")) return "🎵";
  if (mimetype.includes("pdf")) return "📄";
  if (mimetype.includes("zip") || mimetype.includes("compressed")) return "🗜️";
  if (mimetype.includes("word") || mimetype.includes("document")) return "📝";
  if (mimetype.includes("sheet") || mimetype.includes("excel")) return "📊";
  return "📁";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function FileSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        setResults(data.results ?? []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const openFile = async (file: SearchResult) => {
    if (file.storageUrl) {
      const urlRes = await fetch("/api/files/fetch/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: file.storageUrl }),
      });
      if (urlRes.ok) {
        const { url } = await urlRes.json();
        window.open(url, "_blank");
      }
    }
  };

  return (
    <>
      <style>{`
        .fs-overlay {
          position: fixed; inset: 0; z-index: 900;
          background: rgba(0,0,0,0.5);
          display: flex; align-items: flex-start; justify-content: center;
          padding-top: 80px;
        }
        .fs-panel {
          background: var(--surface2); border: 1px solid var(--border);
          border-radius: 16px; width: 560px; max-width: 94vw;
          max-height: 70vh; display: flex; flex-direction: column;
          box-shadow: 0 16px 64px rgba(0,0,0,0.5);
          overflow: hidden;
        }
        .fs-header {
          display: flex; align-items: center; gap: 10px;
          padding: 14px 16px; border-bottom: 1px solid var(--border);
        }
        .fs-input {
          flex: 1; background: var(--surface); border: 1px solid var(--border);
          color: var(--text); border-radius: 10px; padding: 10px 14px;
          font-size: 0.9rem; font-family: 'DM Sans', sans-serif; outline: none;
        }
        .fs-input:focus { border-color: var(--accent); }
        .fs-close {
          background: none; border: none; color: var(--text-muted);
          font-size: 1.2rem; cursor: pointer; padding: 4px 8px; border-radius: 6px;
          font-family: 'DM Sans', sans-serif;
        }
        .fs-close:hover { background: var(--surface); color: var(--text); }
        .fs-body {
          flex: 1; overflow-y: auto; padding: 12px 16px;
        }
        .fs-hint {
          text-align: center; color: var(--text-muted); font-size: 0.8rem;
          padding: 32px 0;
        }
        .fs-result {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; border-radius: 10px;
          cursor: pointer; transition: background 0.12s;
        }
        .fs-result:hover { background: var(--surface); }
        .fs-result-icon { font-size: 1.2rem; flex-shrink: 0; }
        .fs-result-info { flex: 1; min-width: 0; }
        .fs-result-name {
          font-size: 0.85rem; font-weight: 500; color: var(--text);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .fs-result-snippet {
          font-size: 0.75rem; color: var(--text-muted);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;
        }
        .fs-result-meta {
          font-size: 0.7rem; color: var(--text-muted); flex-shrink: 0;
        }
        .fs-spinner {
          text-align: center; padding: 20px; color: var(--text-muted);
        }
      `}</style>
      <div className="fs-overlay" onClick={onClose}>
        <div className="fs-panel" onClick={(e) => e.stopPropagation()}>
          <div className="fs-header">
            <input
              ref={inputRef}
              className="fs-input"
              placeholder="Search files by name or content..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && onClose()}
            />
            <button className="fs-close" onClick={onClose}>✕</button>
          </div>
          <div className="fs-body">
            {query.trim().length < 2 ? (
              <div className="fs-hint">Type at least 2 characters to search</div>
            ) : loading ? (
              <div className="fs-spinner">Searching...</div>
            ) : results.length === 0 ? (
              <div className="fs-hint">No matches found</div>
            ) : (
              results.map((r) => (
                <div key={r._id} className="fs-result" onClick={() => openFile(r)}>
                  <div className="fs-result-icon">{getFileIcon(r.mimetype)}</div>
                  <div className="fs-result-info">
                    <div className="fs-result-name">{r.filename}</div>
                    {r.snippet && <div className="fs-result-snippet">{r.snippet}</div>}
                  </div>
                  <div className="fs-result-meta">{formatBytes(r.size)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
