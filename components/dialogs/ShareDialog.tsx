"use client";

import { useState } from "react";

type FileType = {
  _id: string;
  filename: string;
};

type FolderType = {
  _id: string;
  name: string;
};

type ShareTarget = { type: "file"; item: FileType } | { type: "folder"; item: FolderType };

type ShareDialogProps = {
  shareTarget: ShareTarget | null;
  setShareTarget: (target: ShareTarget | null) => void;
  shareUrl: string;
  setShareUrl: (url: string) => void;
  shareCopied: boolean;
  setShareCopied: (copied: boolean) => void;
  sharePermission: "read" | "add";
  setSharePermission: (perm: "read" | "add") => void;
  shareExpiresInDays: number;
  setShareExpiresInDays: (days: number) => void;
  onCopyUrl: () => void;
  onGenerateFolderShare: () => void;
  onGenerateFileShare: () => void;
};

export default function ShareDialog({
  shareTarget,
  setShareTarget,
  shareUrl,
  setShareUrl,
  shareCopied,
  setShareCopied,
  sharePermission,
  setSharePermission,
  shareExpiresInDays,
  setShareExpiresInDays,
  onCopyUrl,
  onGenerateFolderShare,
  onGenerateFileShare,
}: ShareDialogProps) {
  if (!shareTarget) return null;

  return (
    <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 animate-[fadeIn_0.15s_ease]" onClick={() => setShareTarget(null)}>
      <div className="bg-[#1a1e28] border border-[#252a38] rounded-xl p-6 w-full max-w-sm animate-[slideUp_0.2s_ease]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[1.05rem] font-semibold text-[#e8eaf0] mb-2">Share {shareTarget.type}</h3>
        <p className="text-[0.82rem] text-[#6b7280] mb-4">
          {shareTarget.type === "file"
            ? `Anyone with the link can view ${shareTarget.item.filename}`
            : `Folder link for ${shareTarget.item.name} (${sharePermission === "add" ? "write access" : "read only"})`}
        </p>
        {shareTarget.type === "folder" && (
          <div className="mb-4">
            <div className="flex gap-2 mb-2">
              <button
                className={cn(
                  "flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition",
                  sharePermission === "read"
                    ? "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff]"
                    : "border-gray-600 bg-transparent text-gray-400 hover:bg-gray-800"
                )}
                onClick={() => setSharePermission("read")}
              >
                Read only
              </button>
              <button
                className={cn(
                  "flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition",
                  sharePermission === "add"
                    ? "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff]"
                    : "border-gray-600 bg-transparent text-gray-400 hover:bg-gray-800"
                )}
                onClick={() => setSharePermission("add")}
              >
                Write access
              </button>
            </div>
            <input
              className={cn(
                "w-full bg-[#13161e] border border-[#252a38] rounded-lg px-3 py-2 text-xs text-[#6b7280]",
                "outline-none focus:border-[#6c8eff]/50"
              )}
              type="number"
              min={1}
              max={30}
              value={shareExpiresInDays}
              onChange={(e) => setShareExpiresInDays(Number(e.target.value))}
            />
          </div>
        )}
        {shareUrl ? (
          <div className="flex gap-2">
            <input
              className={cn(
                "flex-1 bg-[#13161e] border border-[#252a38] rounded-lg px-3 py-2 text-xs text-[#6b7280]",
                "truncate outline-none"
              )}
              readOnly
              value={shareUrl}
            />
            <button
              className={cn(
                "px-3 py-2 text-xs font-medium rounded-lg transition",
                shareCopied
                  ? "bg-green-500/20 border border-green-500/30 text-green-400"
                  : "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff] hover:bg-[#6c8eff25]"
              )}
              onClick={onCopyUrl}
            >
              {shareCopied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <div className="text-xs text-[#6b7280]">Generating link...</div>
        )}
        <div className="flex gap-2 mt-6">
          <button className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white" onClick={() => setShareTarget(null)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}