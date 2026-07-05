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

export default function FileSearch({ onClose, topOffset = 80 }: { onClose: () => void; topOffset?: number }) {
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
    <div
      style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: topOffset }}
      onClick={onClose}
    >
      <div
        style={{ background: "#1a1e28", border: "1px solid #252a38", borderRadius: 16, width: 560, maxWidth: "94vw", maxHeight: "70vh", display: "flex", flexDirection: "column", boxShadow: "0 16px 64px rgba(0,0,0,0.5)", overflow: "hidden", fontFamily: "'DM Sans', sans-serif" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid #252a38" }}>
          <input
            ref={inputRef}
            style={{ flex: 1, background: "#13161e", border: "1px solid #252a38", color: "#e8eaf0", borderRadius: 10, padding: "10px 14px", fontSize: "0.9rem", fontFamily: "'DM Sans', sans-serif", outline: "none" }}
            placeholder="Search files by name or content..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
          />
          <button
            style={{ background: "none", border: "none", color: "#6b7280", fontSize: "1.2rem", cursor: "pointer", padding: "4px 8px", borderRadius: 6, fontFamily: "'DM Sans', sans-serif" }}
            onClick={onClose}
          >x</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          {query.trim().length < 2 ? (
            <div style={{ textAlign: "center", color: "#6b7280", fontSize: "0.8rem", padding: "32px 0" }}>Type at least 2 characters to search</div>
          ) : loading ? (
            <div style={{ textAlign: "center", padding: 20, color: "#6b7280" }}>Searching...</div>
          ) : results.length === 0 ? (
            <div style={{ textAlign: "center", color: "#6b7280", fontSize: "0.8rem", padding: "32px 0" }}>No matches found</div>
          ) : (
            results.map((r) => (
              <div
                key={r._id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer", transition: "background 0.12s" }}
                onClick={() => openFile(r)}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#13161e"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div style={{ fontSize: "1.2rem", flexShrink: 0 }}>{getFileIcon(r.mimetype)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 500, color: "#e8eaf0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.filename}</div>
                  {r.snippet && (
                    <div style={{ fontSize: "0.75rem", color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{r.snippet}</div>
                  )}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#6b7280", flexShrink: 0 }}>{formatBytes(r.size)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
