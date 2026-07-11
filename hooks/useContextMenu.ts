"use client";

import { useState, useEffect } from "react";

type FileType = {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  hash?: string;
  storageUrl: string;
  owner_id: string;
  status: "pending" | "uploading" | "paused" | "fallback_cleanup" | "s3_pending" | "uploaded" | "cancelled" | "failed";
  folderId: string | null;
  createdAt: string;
  backend?: "s3" | "telegram";
};

type FolderType = {
  _id: string;
  name: string;
  owner_id: string;
  parent_id?: string | null;
  createdAt: string;
};

type ContextMenu = {
  x: number;
  y: number;
  item: FileType | FolderType;
  itemType: "file" | "folder";
};

export function useContextMenu() {
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctxMenu]);

  const openCtx = (e: React.MouseEvent, item: FileType | FolderType, itemType: "file" | "folder") => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 160;
    const menuHeight = 280;
    let left = e.clientX;
    let top = e.clientY;
    if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - 8 - menuWidth;
    if (top + menuHeight > window.innerHeight) {
      top = e.clientY - 6 - menuHeight;
      if (top < 8) top = 8;
    }
    if (left < 8) left = 8;
    setCtxMenu({ x: left, y: top, item, itemType });
  };

  const closeMenu = () => {
    setCtxMenu(null);
    setOpenMenuId(null);
    setMenuPos(null);
  };

  const toggleMenu = (e: React.MouseEvent, fileId: string) => {
    if (openMenuId === fileId) {
      setOpenMenuId(null);
      setMenuPos(null);
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const menuWidth = 160;
      let left = rect.right - menuWidth;
      if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - 8 - menuWidth;
      if (left < 8) left = 8;
      const menuHeight = 280;
      let top = rect.bottom + 6;
      if (top + menuHeight > window.innerHeight) {
        top = rect.top - 6 - menuHeight;
        if (top < 8) top = 8;
      }
      setMenuPos({ top, left });
      setOpenMenuId(fileId);
    }
  };

  return {
    ctxMenu,
    setCtxMenu,
    openMenuId,
    setOpenMenuId,
    menuPos,
    setMenuPos,
    openCtx,
    toggleMenu,
    closeMenu,
  };
}