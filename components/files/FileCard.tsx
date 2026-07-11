"use client";

import { cn } from "@/shared/utils";

type FileType = {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  createdAt: string;
  folderId: string | null;
  backend?: "s3" | "telegram";
};

type FileCardProps = {
  file: FileType;
  onOpen: (file: FileType) => void;
  onShare: (file: FileType) => void;
  onDownload: (file: FileType) => void;
  onMove: (file: FileType) => void;
  onDelete: (file: FileType) => void;
  onContextMenu: (e: React.MouseEvent, file: FileType) => void;
  formatBytes: (bytes: number) => string;
  folders: { _id: string; name: string }[];
};

export default function FileCard({
  file,
  onOpen,
  onShare,
  onDownload,
  onMove,
  onDelete,
  onContextMenu,
  formatBytes,
  folders,
}: FileCardProps) {
  return (
    <div
      key={file._id}
      onContextMenu={(e) => onContextMenu(e, file)}
      className={cn(
        "flex items-center gap-2 px-3 py-3 rounded-xl border transition-all duration-150",
        "border-[#252a38] bg-[#13161e] hover:border-[#252a3880]"
      )}
    >
      <div className="text-[20px] flex-shrink-0">
        {file.mimetype.startsWith("image/") ? "[IMG]"
          : file.mimetype.startsWith("video/") ? "[VID]"
          : file.mimetype.startsWith("audio/") ? "[AUD]"
          : file.mimetype.includes("pdf") ? "[PDF]"
          : file.mimetype.includes("zip") ? "[ARC]"
          : "[FILE]"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[0.85rem] font-medium text-[#e8eaf0] truncate">{file.filename}</div>
        <div className="text-[0.7rem] text-[#6b7280] truncate">
          {formatBytes(file.size)} - {new Date(file.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          {file.folderId && folders.find(f => f._id === file.folderId) && (
            <span className="text-xs text-[#fbbf24] ml-1">
              [FOLDER] {folders.find(f => f._id === file.folderId)?.name}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
            "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff] hover:bg-[#6c8eff25]"
          )}
          onClick={() => onOpen(file)}
          aria-label={`Open ${file.filename}`}
        >
          Open
        </button>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
            "border-green-600/30 bg-green-500/10 text-green-400 hover:bg-green-500/20"
          )}
          onClick={() => onShare(file)}
          aria-label={`Share ${file.filename}`}
        >
          Share
        </button>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
            "border-[#252a38] text-[#6b7280] bg-[#13161e] hover:bg-[#1a1e28]"
          )}
          onClick={(e) => { e.stopPropagation(); onContextMenu(e, file); }}
          aria-label={`More options for ${file.filename}`}
        >
          ⋮
        </button>
      </div>
    </div>
  );
}