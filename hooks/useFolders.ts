"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

type FolderType = {
  _id: string;
  name: string;
  owner_id: string;
  parent_id?: string | null;
  createdAt: string;
};

export function useFolders(folders: FolderType[], currentFolderId: string | null) {
  const queryClient = useQueryClient();
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [moveFolderTarget, setMoveFolderTarget] = useState<FolderType | null>(null);

  const visibleFolders = folders.filter((folder) => (folder.parent_id ?? null) === currentFolderId);

  const createFolder = async (name: string, parentId: string | null = null) => {
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parent_id: parentId }),
      });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      return true;
    } catch {
      return false;
    }
  };

  const moveFolder = async (folder: FolderType, targetFolderId: string | null) => {
    try {
      const res = await fetch(`/api/folders/${folder._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: targetFolderId }),
      });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch {
      // Handle error
    }
  };

  return {
    newFolderName,
    setNewFolderName,
    showNewFolder,
    setShowNewFolder,
    moveFolderTarget,
    setMoveFolderTarget,
    visibleFolders,
    createFolder,
    moveFolder,
  };
}