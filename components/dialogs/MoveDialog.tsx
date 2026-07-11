"use client";

type FileType = {
  _id: string;
  filename: string;
  folderId: string | null;
};

type FolderType = {
  _id: string;
  name: string;
  parent_id?: string | null;
};

type MoveDialogProps = {
  moveTarget: FileType | null;
  folders: FolderType[];
  uploadedFiles: FileType[];
  currentFolderId: string | null;
  setMoveTarget: (target: FileType | null) => void;
  onMove: (targetFolderId: string | null) => void;
  onCreateFolder: () => void;
  newFolderName: string;
  setNewFolderName: (name: string) => void;
};

export default function MoveDialog({
  moveTarget,
  folders,
  uploadedFiles,
  currentFolderId,
  setMoveTarget,
  onMove,
  onCreateFolder,
  newFolderName,
  setNewFolderName,
}: MoveDialogProps) {
  if (!moveTarget) return null;

  return (
    <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 animate-[fadeIn_0.15s_ease]" onClick={() => setMoveTarget(null)}>
      <div className="bg-[#1a1e28] border border-[#252a38] rounded-xl p-6 w-full max-w-sm animate-[slideUp_0.2s_ease]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[1.05rem] font-semibold text-[#e8eaf0] mb-2">Move file</h3>
        <p className="text-[0.82rem] text-[#6b7280] mb-4">Choose a destination for {moveTarget.filename}</p>
        <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
          <button
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition",
              moveTarget.folderId === null
                ? "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff]"
                : "border-gray-600 bg-transparent text-gray-400 hover:bg-[#13161e]"
            )}
            onClick={() => onMove(null)}
          >
            Root (no folder)
          </button>
          {moveTarget.folderId === null && (
            <div className="grid grid-cols-[1fr_auto] gap-2 mt-2">
              <input
                className="bg-[#13161e] border border-[#6c8eff] rounded-lg px-3 py-1.5 text-sm text-[#e8eaf0] outline-none"
                placeholder="Create folder in root"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onCreateFolder()}
              />
              <button
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff] hover:bg-[#6c8eff25]"
                onClick={onCreateFolder}
              >
                Create & move
              </button>
            </div>
          )}
          {folders.map((folder) => (
            <button
              key={folder._id}
              className={cn(
                "flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition",
                moveTarget.folderId === folder._id
                  ? "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff]"
                  : "border-gray-600 bg-transparent text-gray-400 hover:bg-[#13161e]"
              )}
              onClick={() => onMove(folder._id)}
            >
              {folder.name}
              <span className="text-xs text-[#6b7280] ml-auto">
                {uploadedFiles.filter((f) => f.folderId === folder._id).length}
              </span>
            </button>
          ))}
        </div>
        <button
          className="mt-4 w-full px-4 py-2 text-sm font-medium rounded-lg border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white"
          onClick={() => setMoveTarget(null)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}