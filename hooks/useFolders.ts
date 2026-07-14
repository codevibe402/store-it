"use client";

import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";

type FolderType = {
  _id: string;
  name: string;
  owner_id: string;
  parent_id?: string | null;
  createdAt: string;
};

type DashboardData = {
  files: any[];
  folders: FolderType[];
};

export function useFolders(folders: FolderType[], currentFolderId: string | null) {
  const queryClient = useQueryClient();
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [moveFolderTarget, setMoveFolderTarget] = useState<FolderType | null>(null);

  const visibleFolders = folders.filter((folder) => (folder.parent_id ?? null) === currentFolderId);

  const createFolder = useMutation({
    mutationFn: async ({ name, parentId }: { name: string; parentId: string | null }) => {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parent_id: parentId }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ folder: FolderType }>;
    },
    onMutate: async ({ name }) => {
      const prev = queryClient.getQueryData<DashboardData>(["dashboard"]);
      const tempId = `temp_${Date.now()}`;
      queryClient.setQueryData<DashboardData>(["dashboard"], (old) => {
        if (!old) return old;
        return {
          ...old,
          folders: [...old.folders, { _id: tempId, name, owner_id: "", parent_id: null, createdAt: new Date().toISOString() }],
        };
      });
      return { prev };
    },
    onSuccess: (data) => {
      queryClient.setQueryData<DashboardData>(["dashboard"], (old) => {
        if (!old) return old;
        return {
          ...old,
          folders: [...old.folders.filter((f) => !f._id.startsWith("temp_")), data.folder],
        };
      });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(["dashboard"], context.prev);
    },
  });

  const moveFolder = useMutation({
    mutationFn: async ({ folder, targetFolderId }: { folder: FolderType; targetFolderId: string | null }) => {
      const res = await fetch(`/api/folders/${folder._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: targetFolderId }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  const deleteFolder = useMutation({
    mutationFn: async (folderId: string) => {
      const res = await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  const renameFolder = useMutation({
    mutationFn: async ({ folder, newName }: { folder: FolderType; newName: string }) => {
      const res = await fetch(`/api/folders/${folder._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  return {
    newFolderName,
    setNewFolderName,
    showNewFolder,
    setShowNewFolder,
    moveFolderTarget,
    setMoveFolderTarget,
    visibleFolders,
    createFolder: async (name: string, parentId: string | null = null) => {
      try {
        await createFolder.mutateAsync({ name, parentId });
        return true;
      } catch {
        return false;
      }
    },
    moveFolder: (folder: FolderType, targetFolderId: string | null) => moveFolder.mutateAsync({ folder, targetFolderId }),
    deleteFolder: (folderId: string) => deleteFolder.mutateAsync(folderId),
    renameFolder: (folder: FolderType, newName: string) => renameFolder.mutateAsync({ folder, newName }),
  };
}
