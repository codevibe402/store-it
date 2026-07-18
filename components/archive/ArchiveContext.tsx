"use client";

import { createContext, useContext } from "react";
import type { useFiles } from "@/hooks/useFiles";
import type { useFolders } from "@/hooks/useFolders";
import type { useFolderShare } from "@/hooks/useFolderShare";
import type { ArchivePageId, CtxMenuTarget, FileFilter, FileType, FolderType } from "./types";

export type ArchiveContextValue = {
  isLoading: boolean;
  files: FileType[];
  folders: FolderType[];

  activePage: ArchivePageId;
  setActivePage: (page: ArchivePageId) => void;

  search: string;
  setSearch: (v: string) => void;
  sortOrder: string;
  setSortOrder: (v: string) => void;
  filter: FileFilter;
  setFilter: (v: FileFilter) => void;

  selectedFolderId: string | null;
  selectedFolder: FolderType | null;
  currentFolderId: string | null;
  currentFolders: FolderType[];
  rootFolders: FolderType[];
  folderFileCounts: Record<string, number>;
  openFolder: (folder: FolderType) => void;
  goBackToRoot: () => void;

  visibleFiles: FileType[];
  allFilteredFiles: FileType[];
  totalBytesUsed: number;

  showNewFolder: boolean;
  setShowNewFolder: (v: boolean) => void;
  newFolderName: string;
  setNewFolderName: (v: string) => void;
  handleCreateFolder: () => void;

  renameId: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  startRename: (folder: FolderType) => void;
  handleRenameSubmit: (folder: FolderType) => void;
  cancelRename: () => void;

  ctxMenuTarget: CtxMenuTarget;
  setCtxMenuTarget: (t: CtxMenuTarget) => void;
  ctxMenuRef: React.RefObject<HTMLDivElement | null>;
  handleFolderContextMenu: (e: React.MouseEvent, folder: FolderType) => void;
  handleFileContextMenu: (e: React.MouseEvent, file: FileType) => void;

  fileActions: ReturnType<typeof useFiles>;
  folderActions: ReturnType<typeof useFolders>;
  folderShare: ReturnType<typeof useFolderShare>;
};

export const ArchiveContext = createContext<ArchiveContextValue | null>(null);

export function useArchive(): ArchiveContextValue {
  const ctx = useContext(ArchiveContext);
  if (!ctx) throw new Error("useArchive must be used within ArchiveShell");
  return ctx;
}
