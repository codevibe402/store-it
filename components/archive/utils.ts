import type { FileFilter } from "./types";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function matchesFilter(mimetype: string, filter: FileFilter): boolean {
  switch (filter) {
    case "images":
      return mimetype.startsWith("image/");
    case "videos":
      return mimetype.startsWith("video/");
    case "documents":
      return (
        mimetype.includes("pdf") ||
        mimetype.includes("document") ||
        mimetype.includes("sheet") ||
        mimetype === "text/plain" ||
        mimetype.includes("presentation")
      );
    case "archives":
      return (
        mimetype.includes("zip") ||
        mimetype.includes("rar") ||
        mimetype.includes("7z") ||
        mimetype.includes("tar") ||
        mimetype.includes("gzip") ||
        mimetype.includes("compress")
      );
    default:
      return true;
  }
}

export type FileKind = "image" | "doc" | "video" | "other";

export function fileKind(mimetype: string): FileKind {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (
    mimetype.includes("pdf") ||
    mimetype.includes("document") ||
    mimetype.includes("text") ||
    mimetype.includes("sheet") ||
    mimetype.includes("presentation")
  )
    return "doc";
  return "other";
}
