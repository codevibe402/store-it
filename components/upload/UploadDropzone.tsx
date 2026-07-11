"use client";

import { cn } from "@/shared/utils";

type UploadDropzoneProps = {
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onClick: () => void;
  currentFolder?: { name: string } | null;
  inputRef: React.RefObject<HTMLInputElement>;
};

export default function UploadDropzone({
  dragging,
  setDragging,
  onDrop,
  onDragOver,
  onDragLeave,
  onClick,
  currentFolder,
  inputRef,
}: UploadDropzoneProps) {
  return (
    <div
      className={cn(
        "rounded-xl border-dashed transition-all duration-200 cursor-pointer",
        "border-[1.5px] px-8 py-10 text-center gap-2 flex flex-col items-center justify-center",
        dragging ? "border-accent border-solid bg-[#6c8eff1a] transform -translate-y-1" : "border-[#252a38]"
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
    >
      <input ref={inputRef} type="file" hidden onChange={() => {}} />
      <div className="w-12 h-12 rounded-xl bg-[#1a1e28] border border-[#252a38] flex items-center justify-center">
        <svg className="w-6 h-6 text-[#6c8eff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
      </div>
      <div className="text-[0.95rem] font-semibold text-[#e8eaf0]">
        Drop your file here{currentFolder ? ` into "${currentFolder.name}"` : ""}
      </div>
      <div className="text-[0.78rem] text-[#6b7280] mb-2">
        or <span className="text-[#6c8eff] font-medium">browse</span> — under 10 MB uploads instantly, larger files use multipart
      </div>
    </div>
  );
}