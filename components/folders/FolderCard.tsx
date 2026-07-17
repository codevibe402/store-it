"use client";

import { cn } from "@/shared/utils";

type FolderType = {
  _id: string;
  name: string;
  owner_id: string;
  parent_id?: string | null;
  createdAt: string;
};

type FolderCardProps = {
  folder: FolderType;
  fileCount: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent, folder: FolderType) => void;
};

export default function FolderCard({ folder, fileCount, onClick, onContextMenu }: FolderCardProps) {
  return (
    <div
      key={folder._id}
      onClick={onClick}
      onContextMenu={(e) => onContextMenu(e, folder)}
      className={cn(
        "relative flex flex-col gap-2 px-3 py-7 rounded-xl border transition-all duration-150 cursor-pointer",
        "border-[#252a38] bg-[#13161e] hover:border-[#fbbf24]/30 hover:transform hover:-translate-y-1"
      )}
    >
      <button
        className={cn(
          "absolute top-2 right-2 flex items-center justify-center rounded-lg border px-2 py-1 text-xs font-medium transition",
          "border-[#252a38] text-[#6b7280] bg-[#13161e] hover:bg-[#1a1e28]"
        )}
        onClick={(e) => { e.stopPropagation(); onContextMenu(e, folder); }}
        aria-label={`More options for ${folder.name}`}
      >
        ⋮
      </button>
      <div className="text-[28px]">📁</div>
      <div className="text-[0.85rem] font-medium text-[#e8eaf0] truncate pr-2">{folder.name}</div>
      <div className="text-[0.7rem] text-[#6b7280]">{fileCount} files</div>
    </div>
  );
}