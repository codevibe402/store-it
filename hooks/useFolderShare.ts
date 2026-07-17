"use client";

import { useState } from "react";
import { toast } from "sonner";

export type FolderRole = "viewer" | "editor" | "owner";

export type AccessGrant = {
  id: string;
  principal: { _id?: string; name?: string; email: string } | string | null;
  role: FolderRole;
  state: "active" | "revoked";
  direct: boolean;
  via: string;
};

export type AccessLink = {
  id: string;
  role: "viewer" | "editor";
  expiresAt: string;
  hasPassword: boolean;
  maxUses: number | null;
  useCount: number;
  direct: boolean;
  via: string;
};

export type FolderAccess = {
  owner: { id: string; email: string };
  grants: AccessGrant[];
  links: AccessLink[];
};

type FolderType = { _id: string; name: string };

// Owns every piece of state needed by ShareDialog for the folder side of
// sharing: the current access list (GET /api/folders/:id/access), the
// most-recently-created link's one-time-visible token URL, and the
// mutating actions (share with a user, create/revoke a link, revoke a
// grant) — all speaking the viewer/editor/owner role vocabulary the new
// permission engine uses, nothing translated from an older shape.
export function useFolderShare() {
  const [folderTarget, setFolderTarget] = useState<FolderType | null>(null);
  const [access, setAccess] = useState<FolderAccess | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshAccess = async (folderId: string) => {
    setAccessLoading(true);
    try {
      const res = await fetch(`/api/folders/${folderId}/access`);
      if (!res.ok) throw new Error("Failed to load access");
      setAccess(await res.json());
    } catch {
      toast.error("Couldn't load who has access to this folder");
    } finally {
      setAccessLoading(false);
    }
  };

  const openFolderShare = async (folder: FolderType) => {
    setFolderTarget(folder);
    setAccess(null);
    setNewLinkUrl(null);
    setLinkCopied(false);
    await refreshAccess(folder._id);
  };

  const closeFolderShare = () => {
    setFolderTarget(null);
    setAccess(null);
    setNewLinkUrl(null);
  };

  const shareWithUser = async (email: string, role: FolderRole) => {
    if (!folderTarget) return false;
    setBusy(true);
    try {
      const res = await fetch(`/api/folders/${folderTarget._id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "user", role, email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to share");
      }
      toast.success(`Shared with ${email}`);
      await refreshAccess(folderTarget._id);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to share");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createLink = async (role: "viewer" | "editor", expiresInDays: number, password: string) => {
    if (!folderTarget) return false;
    setBusy(true);
    try {
      const res = await fetch(`/api/folders/${folderTarget._id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "link", role, expiresInDays, password: password || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create link");
      }
      const data = await res.json();
      setNewLinkUrl(data.shareUrl);
      await refreshAccess(folderTarget._id);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create link");
      return false;
    } finally {
      setBusy(false);
    }
  };

  // `deny: true` is used for a grant that's only inherited from an
  // ancestor here — there's no direct row on this exact folder to delete,
  // so it instead writes an explicit "revoked" row here that overrides
  // the ancestor's grant for this subtree (see permissionService.ts).
  const revokeGrant = async (userId: string, deny = false) => {
    if (!folderTarget || !userId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/folders/${folderTarget._id}/share`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, deny }),
      });
      if (!res.ok) throw new Error("Failed to remove access");
      await refreshAccess(folderTarget._id);
    } catch {
      toast.error("Failed to remove access");
    } finally {
      setBusy(false);
    }
  };

  const revokeLink = async (linkId: string) => {
    if (!folderTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/folders/${folderTarget._id}/share`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkId }),
      });
      if (!res.ok) throw new Error("Failed to revoke link");
      if (newLinkUrl) setNewLinkUrl(null);
      await refreshAccess(folderTarget._id);
    } catch {
      toast.error("Failed to revoke link");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  return {
    folderTarget,
    access,
    accessLoading,
    newLinkUrl,
    linkCopied,
    busy,
    openFolderShare,
    closeFolderShare,
    shareWithUser,
    createLink,
    revokeGrant,
    revokeLink,
    copyLink,
  };
}
