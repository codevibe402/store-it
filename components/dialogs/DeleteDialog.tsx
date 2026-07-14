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
    <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 fade-in" onClick={() => setDeleteTarget(null)}>
      <div className="bg-[#1a1e28] border border-[#252a38] rounded-xl p-6 w-full max-w-sm slide-up" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[1.05rem] font-semibold text-[#e8eaf0] mb-2">Confirm delete</h3>
        <p className="text-[0.82rem] text-[#6b7280] mb-6">
          {deleteTarget.type === "file"
            ? `Delete "${deleteTarget.item.filename}"? This cannot be undone.`
            : `Delete folder "${deleteTarget.item.name}" and all its contents? This cannot be undone.`}
        </p>
        <div className="flex gap-2">
          <button
            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white"
            onClick={() => setDeleteTarget(null)}
          >
            Cancel
          </button>
          <button
            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-red-600/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}