"use client";

type FileType = {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  folderId: string | null;
};

type FolderType = {
  _id: string;
  name: string;
  parent_id?: string | null;
};

type DeleteDialogProps = {
  deleteTarget: { type: "file"; item: FileType } | { type: "folder"; item: FolderType } | null;
  setDeleteTarget: (target: { type: "file"; item: FileType } | { type: "folder"; item: FolderType } | null) => void;
  onDelete: () => void;
};

export default function DeleteDialog({ deleteTarget, setDeleteTarget, onDelete }: DeleteDialogProps) {
  if (!deleteTarget) return null;

  return (
    <div className="fixed inset-0 bg-[rgba(10,13,11,0.7)] flex items-center justify-center z-50 fade-in" onClick={() => setDeleteTarget(null)}>
      <div className="bg-[var(--panel,#1a1e28)] border border-[var(--line-strong,#252a38)] rounded-[2px] p-6 w-full max-w-sm slide-up" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[1.05rem] font-semibold text-[var(--paper,#e8eaf0)] mb-2">Confirm delete</h3>
        <p className="text-[0.82rem] text-[var(--sage,#6b7280)] mb-6">
          {deleteTarget.type === "file"
            ? `Delete "${deleteTarget.item.filename}"? This cannot be undone.`
            : `Delete folder "${deleteTarget.item.name}" and all its contents? This cannot be undone.`}
        </p>
        <div className="flex gap-2">
          <button
            className="flex-1 px-4 py-2 text-sm font-medium rounded-[2px] border border-[var(--line-strong,#4b5563)] text-[var(--paper-dim,#9ca3af)] hover:bg-[var(--panel-2,#1f2937)] hover:text-[var(--paper,#fff)]"
            onClick={() => setDeleteTarget(null)}
          >
            Cancel
          </button>
          <button
            className="flex-1 px-4 py-2 text-sm font-medium rounded-[2px] border border-[var(--rust,#dc2626)]/40 bg-[var(--rust,#dc2626)]/10 text-[var(--rust,#f87171)] hover:bg-[var(--rust,#dc2626)]/20"
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}