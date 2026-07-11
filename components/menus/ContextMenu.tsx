"use client";

type FileType = {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  folderId: string | null;
  createdAt: string;
  backend?: "s3" | "telegram";
};

type FolderType = {
  _id: string;
  name: string;
  parent_id?: string | null;
  createdAt: string;
};

type ContextMenuProps = {
  ctxMenu: { x: number; y: number; item: FileType | FolderType; itemType: "file" | "folder" } | null;
  setCtxMenu: (menu: { x: number; y: number; item: FileType | FolderType; itemType: "file" | "folder" } | null) => void;
  onOpen: (item: FileType | FolderType) => void;
  onDownload: (item: FileType | FolderType) => void;
  onDownloadFolder: (folder: FolderType) => void;
  onCopyLink: (item: FileType | FolderType, isFolder: boolean) => void;
  onViewDetails: (item: FileType) => void;
  onDuplicate: (item: FileType) => void;
  onShare: (item: FileType | FolderType) => void;
  onMove: (item: FileType | FolderType) => void;
  onDelete: (item: FileType | FolderType) => void;
  onOpenFolder: (folder: FolderType) => void;
  onShareFolderRead: (folder: FolderType) => void;
  onShareFolderWrite: (folder: FolderType) => void;
  onMoveFolder: (folder: FolderType) => void;
  onDeleteFolder: (folder: FolderType) => void;
  menuPos: { top: number; left: number } | null;
};

export default function ContextMenu({
  ctxMenu,
  setCtxMenu,
  onOpen,
  onDownload,
  onDownloadFolder,
  onCopyLink,
  onViewDetails,
  onDuplicate,
  onShare,
  onMove,
  onDelete,
  onOpenFolder,
  onShareFolderRead,
  onShareFolderWrite,
  onMoveFolder,
  onDeleteFolder,
  menuPos,
}: ContextMenuProps) {
  if (!ctxMenu || !menuPos) return null;

  const { item, itemType } = ctxMenu;

  if (itemType === "file") {
    const file = item as FileType;
    return (
      <div
        className="fixed z-[1000] min-w-[160px] animate-[ctxIn_0.12s_ease] rounded-[12px] border border-[#252a38] bg-[#1a1e28] p-2 shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
        style={{ left: menuPos.left, top: menuPos.top }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
          onClick={() => { onOpen(file); setCtxMenu(null); }}
        >
          Open
        </button>
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
          onClick={() => { onCopyLink(file, false); setCtxMenu(null); }}
        >
          Copy link
        </button>
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
          onClick={() => { onViewDetails(file); setCtxMenu(null); }}
        >
          View details
        </button>
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
          onClick={() => { onDuplicate(file); setCtxMenu(null); }}
        >
          Duplicate
        </button>
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
          onClick={() => { onShare(file); setCtxMenu(null); }}
        >
          Share
        </button>
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
          onClick={() => { onDownload(file); setCtxMenu(null); }}
        >
          Download
        </button>
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
          onClick={() => { onMove(file); setCtxMenu(null); }}
        >
          Move to folder
        </button>
        <div className="h-px bg-[#252a38] my-1" />
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#f87171] transition-all duration-100 hover:bg-[#13161e] hover:text-[#f87171]"
          onClick={() => { onDelete(file); setCtxMenu(null); }}
        >
          Delete
        </button>
      </div>
    );
  }

  const folder = item as FolderType;
  return (
    <div
      className="fixed z-[1000] min-w-[160px] animate-[ctxIn_0.12s_ease] rounded-[12px] border border-[#252a38] bg-[#1a1e28] p-2 shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
      style={{ left: menuPos.left, top: menuPos.top }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
        onClick={() => { onOpenFolder(folder); setCtxMenu(null); }}
      >
        Open folder
      </button>
      <button
        className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
        onClick={() => { onShareFolderRead(folder); setCtxMenu(null); }}
      >
        Share read link
      </button>
      <button
        className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
        onClick={() => { onShareFolderWrite(folder); setCtxMenu(null); }}
      >
        Share write link
      </button>
      <button
        className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
        onClick={() => { onMoveFolder(folder); setCtxMenu(null); }}
      >
        Move folder
      </button>
      <button
        className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
        onClick={() => { onDownloadFolder(folder); setCtxMenu(null); }}
      >
        Download as ZIP
      </button>
      <div className="h-px bg-[#252a38] my-1" />
      <button
        className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem] text-[#f87171] transition-all duration-100 hover:bg-[#13161e] hover:text-[#f87171]"
        onClick={() => { onDeleteFolder(folder); setCtxMenu(null); }}
      >
        Delete folder
      </button>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}