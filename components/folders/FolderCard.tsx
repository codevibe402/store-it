"use client";

import { cn } from "@/shared/utils";

type FolderType = {
  _id: string;
  name: string;
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
        "flex flex-col gap-1.5 px-3 py-4 rounded-xl border transition-all duration-150 cursor-pointer",
        "border-[#252a38] bg-[#13161e] hover:border-[#fbbf24]/30 hover:transform hover:-translate-y-1"
      )}
    >
      <div className="text-[26px]">📁</div>
      <div className="text-[0.8rem] font-medium text-[#e8eaf0] truncate">{folder.name}</div>
      <div className="text-[0.68rem] text-[#6b7280]">{fileCount} files</div>
    </div>
  );
}