"use client";

import { useState } from "react";
import type { FolderAccess, FolderRole } from "@/hooks/useFolderShare";

type FileType = { _id: string; filename: string };
type FolderType = { _id: string; name: string };

type ShareDialogProps = {
  // File sharing — simple, unchanged behavior: a single read-only link.
  fileTarget: FileType | null;
  onCloseFile: () => void;
  fileShareUrl: string;
  fileShareCopied: boolean;
  onCopyFileShareUrl: () => void;

  // Folder sharing — people + roles + links, backed by GET /access.
  folderTarget: FolderType | null;
  onCloseFolder: () => void;
  access: FolderAccess | null;
  accessLoading: boolean;
  newLinkUrl: string | null;
  linkCopied: boolean;
  busy: boolean;
  onCopyLink: (url: string) => void;
  onShareWithUser: (email: string, role: FolderRole) => Promise<boolean>;
  onCreateLink: (role: "viewer" | "editor", expiresInDays: number, password: string) => Promise<boolean>;
  onRevokeGrant: (userId: string, deny?: boolean) => void;
  onRevokeLink: (linkId: string) => void;
};

const ROLE_LABEL: Record<FolderRole, string> = { viewer: "Viewer", editor: "Editor", owner: "Owner" };

function principalLabel(p: FolderAccess["grants"][number]["principal"]): string {
  if (!p) return "Unknown user";
  if (typeof p === "string") return p;
  return p.name || p.email;
}

function principalId(p: FolderAccess["grants"][number]["principal"]): string {
  if (!p) return "";
  if (typeof p === "string") return p;
  return p._id ?? p.email;
}

export default function ShareDialog({
  fileTarget,
  onCloseFile,
  fileShareUrl,
  fileShareCopied,
  onCopyFileShareUrl,
  folderTarget,
  onCloseFolder,
  access,
  accessLoading,
  newLinkUrl,
  linkCopied,
  busy,
  onCopyLink,
  onShareWithUser,
  onCreateLink,
  onRevokeGrant,
  onRevokeLink,
}: ShareDialogProps) {
  const [email, setEmail] = useState("");
  const [userRole, setUserRole] = useState<FolderRole>("viewer");
  const [linkRole, setLinkRole] = useState<"viewer" | "editor">("viewer");
  const [linkExpiresInDays, setLinkExpiresInDays] = useState(7);
  const [linkPassword, setLinkPassword] = useState("");
  const [showLinkForm, setShowLinkForm] = useState(false);

  if (fileTarget) {
    return (
      <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 fade-in" onClick={onCloseFile}>
        <div className="bg-[#1a1e28] border border-[#252a38] rounded-xl p-6 w-full max-w-sm slide-up" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-[1.05rem] font-semibold text-[#e8eaf0] mb-2">Share file</h3>
          <p className="text-[0.82rem] text-[#6b7280] mb-4">Anyone with the link can view {fileTarget.filename}</p>
          {fileShareUrl ? (
            <div className="flex gap-2">
              <input className="flex-1 bg-[#13161e] border border-[#252a38] rounded-lg px-3 py-2 text-xs text-[#6b7280] truncate outline-none" readOnly value={fileShareUrl} />
              <button
                className={cn(
                  "px-3 py-2 text-xs font-medium rounded-lg transition",
                  fileShareCopied ? "bg-green-500/20 border border-green-500/30 text-green-400" : "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff] hover:bg-[#6c8eff25]"
                )}
                onClick={onCopyFileShareUrl}
              >
                {fileShareCopied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : (
            <div className="text-xs text-[#6b7280]">Generating link...</div>
          )}
          <div className="flex gap-2 mt-6">
            <button className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white" onClick={onCloseFile}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!folderTarget) return null;

  const activeLinks = access?.links.filter((l) => l.direct) ?? [];
  const grants = access?.grants ?? [];

  return (
    <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 fade-in" onClick={onCloseFolder}>
      <div className="bg-[#1a1e28] border border-[#252a38] rounded-xl p-6 w-full max-w-md slide-up max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[1.05rem] font-semibold text-[#e8eaf0] mb-1">Share &ldquo;{folderTarget.name}&rdquo;</h3>
        <p className="text-[0.78rem] text-[#6b7280] mb-4">
          Everyone below can reach every file and subfolder inside — access is inherited automatically, nothing needs sharing individually.
        </p>

        {/* Add people */}
        <div className="mb-5">
          <div className="flex gap-2">
            <input
              className="flex-1 bg-[#13161e] border border-[#252a38] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-[#6c8eff]/50"
              placeholder="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && email.trim() && onShareWithUser(email.trim(), userRole).then((ok) => ok && setEmail(""))}
            />
            <select
              className="bg-[#13161e] border border-[#252a38] rounded-lg px-2 text-xs text-white outline-none"
              value={userRole}
              onChange={(e) => setUserRole(e.target.value as FolderRole)}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="owner">Owner</option>
            </select>
            <button
              disabled={!email.trim() || busy}
              onClick={() => email.trim() && onShareWithUser(email.trim(), userRole).then((ok) => ok && setEmail(""))}
              className="px-3 py-2 text-xs font-medium rounded-lg border border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff] hover:bg-[#6c8eff25] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Share
            </button>
          </div>
        </div>

        {/* People with access */}
        <div className="mb-5">
          <div className="text-[0.72rem] font-semibold uppercase tracking-wide text-[#6b7280] mb-2">People with access</div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#e8eaf0]">{access?.owner.email ?? "…"}</span>
              <span className="text-[#6b7280]">Owner</span>
            </div>
            {accessLoading && <div className="text-xs text-[#6b7280]">Loading…</div>}
            {!accessLoading && grants.length === 0 && (
              <div className="text-xs text-[#6b7280]">No one else has access yet.</div>
            )}
            {grants.map((g) => (
              <div key={g.id} className="flex items-center justify-between text-xs gap-2">
                <span className="text-[#e8eaf0] truncate">
                  {principalLabel(g.principal)}
                  {!g.direct && <span className="text-[#6b7280]"> · inherited</span>}
                  {g.state === "revoked" && <span className="text-red-400"> · blocked</span>}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-[#6b7280]">{ROLE_LABEL[g.role]}</span>
                  <button
                    onClick={() => onRevokeGrant(principalId(g.principal), !g.direct)}
                    className="text-red-400 hover:text-red-300"
                    title={g.direct ? "Remove access" : "Block inherited access here"}
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Links */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[0.72rem] font-semibold uppercase tracking-wide text-[#6b7280]">Share via link</div>
            <button className="text-[0.72rem] text-[#6c8eff] hover:text-[#8fa6ff]" onClick={() => setShowLinkForm((v) => !v)}>
              {showLinkForm ? "Cancel" : "New link"}
            </button>
          </div>

          {showLinkForm && (
            <div className="flex flex-col gap-2 mb-3 p-3 rounded-lg border border-[#252a38] bg-[#13161e]">
              <div className="flex gap-2">
                <select
                  className="flex-1 bg-[#1a1e28] border border-[#252a38] rounded-lg px-2 py-1.5 text-xs text-white outline-none"
                  value={linkRole}
                  onChange={(e) => setLinkRole(e.target.value as "viewer" | "editor")}
                >
                  <option value="viewer">Viewer — view &amp; download</option>
                  <option value="editor">Editor — upload, rename, move, delete</option>
                </select>
                <input
                  className="w-20 bg-[#1a1e28] border border-[#252a38] rounded-lg px-2 py-1.5 text-xs text-white outline-none"
                  type="number"
                  min={1}
                  max={30}
                  value={linkExpiresInDays}
                  onChange={(e) => setLinkExpiresInDays(Number(e.target.value))}
                  title="Expires in days"
                />
              </div>
              <input
                className="bg-[#1a1e28] border border-[#252a38] rounded-lg px-2 py-1.5 text-xs text-white outline-none"
                type="password"
                placeholder="Optional password"
                value={linkPassword}
                onChange={(e) => setLinkPassword(e.target.value)}
              />
              <button
                disabled={busy}
                onClick={async () => {
                  const ok = await onCreateLink(linkRole, linkExpiresInDays, linkPassword);
                  if (ok) { setShowLinkForm(false); setLinkPassword(""); }
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#6c8eff] text-white hover:bg-[#5a7cf0] disabled:opacity-40"
              >
                Create link
              </button>
            </div>
          )}

          {newLinkUrl && (
            <div className="flex gap-2 mb-3">
              <input className="flex-1 bg-[#13161e] border border-[#252a38] rounded-lg px-3 py-2 text-xs text-[#6b7280] truncate outline-none" readOnly value={newLinkUrl} />
              <button
                className={cn(
                  "px-3 py-2 text-xs font-medium rounded-lg transition shrink-0",
                  linkCopied ? "bg-green-500/20 border border-green-500/30 text-green-400" : "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff] hover:bg-[#6c8eff25]"
                )}
                onClick={() => onCopyLink(newLinkUrl)}
              >
                {linkCopied ? "Copied" : "Copy"}
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {activeLinks.length === 0 && !accessLoading && (
              <div className="text-xs text-[#6b7280]">No active links on this folder.</div>
            )}
            {activeLinks.map((l) => (
              <div key={l.id} className="flex items-center justify-between text-xs gap-2">
                <span className="text-[#e8eaf0]">
                  {ROLE_LABEL[l.role]} link
                  {l.hasPassword && <span className="text-[#6b7280]"> · password</span>}
                  <span className="text-[#6b7280]"> · expires {new Date(l.expiresAt).toLocaleDateString()}</span>
                </span>
                <button onClick={() => onRevokeLink(l.id)} className="text-red-400 hover:text-red-300 shrink-0">Revoke</button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white" onClick={onCloseFolder}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
