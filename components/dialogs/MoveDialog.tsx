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
    <div className="fixed inset-0 bg-[rgba(10,13,11,0.7)] flex items-center justify-center z-50 fade-in" onClick={() => setMoveTarget(null)}>
      <div className="bg-[var(--panel,#1a1e28)] border border-[var(--line-strong,#252a38)] rounded-[2px] p-6 w-full max-w-sm slide-up" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[1.05rem] font-semibold text-[var(--paper,#e8eaf0)] mb-2">Move file</h3>
        <p className="text-[0.82rem] text-[var(--sage,#6b7280)] mb-4">Choose a destination for {moveTarget.filename}</p>
        <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
          <button
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-[2px] border transition",
              moveTarget.folderId === null
                ? "border-[var(--brass,#6c8eff)]/40 bg-[var(--brass,#6c8eff)]/10 text-[var(--brass-bright,#6c8eff)]"
                : "border-[var(--line-strong,#4b5563)] bg-transparent text-[var(--paper-dim,#9ca3af)] hover:bg-[var(--panel-2,#13161e)]"
            )}
            onClick={() => onMove(null)}
          >
            Root (no folder)
          </button>
          {moveTarget.folderId === null && (
            <div className="grid grid-cols-[1fr_auto] gap-2 mt-2">
              <input
                className="bg-[var(--panel-2,#13161e)] border border-[var(--brass,#6c8eff)] rounded-[2px] px-3 py-1.5 text-sm text-[var(--paper,#e8eaf0)] outline-none"
                placeholder="Create folder in root"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onCreateFolder()}
              />
              <button
                className="px-2.5 py-1.5 text-xs font-medium rounded-[2px] border border-[var(--brass,#6c8eff)]/40 bg-[var(--brass,#6c8eff)]/10 text-[var(--brass-bright,#6c8eff)] hover:bg-[var(--brass,#6c8eff)]/20"
                onClick={onCreateFolder}
              >
                Create &amp; move
              </button>
            </div>
          )}
          {folders.map((folder) => (
            <button
              key={folder._id}
              className={cn(
                "flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-medium rounded-[2px] border transition",
                moveTarget.folderId === folder._id
                  ? "border-[var(--brass,#6c8eff)]/40 bg-[var(--brass,#6c8eff)]/10 text-[var(--brass-bright,#6c8eff)]"
                  : "border-[var(--line-strong,#4b5563)] bg-transparent text-[var(--paper-dim,#9ca3af)] hover:bg-[var(--panel-2,#13161e)]"
              )}
              onClick={() => onMove(folder._id)}
            >
              {folder.name}
              <span className="text-xs text-[var(--sage,#6b7280)] ml-auto">
                {uploadedFiles.filter((f) => f.folderId === folder._id).length}
              </span>
            </button>
          ))}
        </div>
        <button
          className="mt-4 w-full px-4 py-2 text-sm font-medium rounded-[2px] border border-[var(--line-strong,#4b5563)] text-[var(--paper-dim,#9ca3af)] hover:bg-[var(--panel-2,#1f2937)] hover:text-[var(--paper,#fff)]"
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