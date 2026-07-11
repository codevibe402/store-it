"use client";

type FolderBreadcrumbProps = {
  currentFolder: { name: string; parent_id?: string | null } | null;
  onBack: () => void;
  fileCount: number;
};

export default function FolderBreadcrumb({ currentFolder, onBack, fileCount }: FolderBreadcrumbProps) {
  if (!currentFolder) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-[#6b7280] font-medium">Drop files to upload, or browse from your device.</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        className="flex items-center gap-1.5 rounded-lg border border-gray-600 bg-transparent px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:bg-gray-800"
        onClick={onBack}
        aria-label="Go back to parent folder"
      >
        ← Back
      </button>
      <span className="text-xs text-[#6b7280] font-medium">
        {fileCount} file{fileCount !== 1 ? "s" : ""} in "{currentFolder.name}"
      </span>
    </div>
  );
}