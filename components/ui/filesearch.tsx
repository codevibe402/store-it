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
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-20" onClick={onClose}>
        <div
          className="flex w-[560px] max-w-[94vw] max-h-[70vh] flex-col overflow-hidden rounded-[16px] border border-[var(--border,#252a38)] bg-[var(--surface2,#1a1e28)] shadow-[0_16px_64px_rgba(0,0,0,0.5)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-[10px] border-b border-[var(--border,#252a38)] px-4 py-[14px]">
            <input
              ref={inputRef}
              className="flex-1 rounded-[10px] border border-[var(--border,#252a38)] bg-[var(--surface,#13161e)] px-[14px] py-[10px] text-[0.9rem] text-[var(--text,#e8eaf0)] outline-none placeholder:text-[var(--text-muted,#6b7280)] focus:border-[var(--accent,#6c8eff)]"
              placeholder="Search files by name or content..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && onClose()}
            />
            <button
              className="cursor-pointer rounded-[6px] border-none bg-none px-2 py-1 text-[1.2rem] text-[var(--text-muted,#6b7280)] hover:bg-[var(--surface,#13161e)] hover:text-[var(--text,#e8eaf0)]"
              onClick={onClose}
            >x</button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {query.trim().length < 2 ? (
              <div className="py-8 text-center text-[0.8rem] text-[var(--text-muted,#6b7280)]">Type at least 2 characters to search</div>
            ) : loading ? (
              <div className="py-5 text-center text-[0.8rem] text-[var(--text-muted,#6b7280)]">Searching...</div>
            ) : results.length === 0 ? (
              <div className="py-8 text-center text-[0.8rem] text-[var(--text-muted,#6b7280)]">No matches found</div>
            ) : (
              results.map((r) => (
                <div
                  key={r._id}
                  className="flex cursor-pointer items-center gap-[10px] rounded-[10px] px-3 py-[10px] transition-colors hover:bg-[var(--surface,#13161e)]"
                  onClick={() => openFile(r)}
                >
                  <div className="shrink-0 text-[1.2rem]">{getFileIcon(r.mimetype)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.85rem] font-medium text-[var(--text,#e8eaf0)]">{r.filename}</div>
                    {r.snippet && (
                      <div className="mt-0.5 truncate text-[0.75rem] text-[var(--text-muted,#6b7280)]">{r.snippet}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-[0.7rem] text-[var(--text-muted,#6b7280)]">{formatBytes(r.size)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
