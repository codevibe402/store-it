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
  if (mimetype.startsWith("image/")) return "[IMG]";
  if (mimetype.startsWith("video/")) return "[VID]";
  if (mimetype.startsWith("audio/")) return "[AUD]";
  if (mimetype.includes("pdf")) return "[PDF]";
  if (mimetype.includes("zip") || mimetype.includes("compressed")) return "[ARC]";
  if (mimetype.includes("word") || mimetype.includes("document")) return "[DOC]";
  if (mimetype.includes("sheet") || mimetype.includes("excel")) return "[SHT]";
  return "[FILE]";
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

  const openFile = (file: SearchResult) => {
    window.open(`/api/files/${file._id}/download?preview=1`, "_blank");
  };

  return (
    <>
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
            <button className="fs-close" onClick={onClose}>x</button>
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
