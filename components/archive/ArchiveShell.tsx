"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useFiles } from "@/hooks/useFiles";
import { useFolders } from "@/hooks/useFolders";
import { useFolderShare } from "@/hooks/useFolderShare";
import { ShareDialog, DeleteDialog, VersionsDialog, MoveDialog } from "@/components/dialogs";
import { ArchiveContext, type ArchiveContextValue } from "./ArchiveContext";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import ContextMenu from "./ContextMenu";
import NewFolderModal from "./NewFolderModal";
import OverviewPage from "./OverviewPage";
import FilesPage from "./FilesPage";
import FoldersPage from "./FoldersPage";
import SharedPage from "./SharedPage";
import TrashPage from "./TrashPage";
import SettingsPage from "./SettingsPage";
import { matchesFilter } from "./utils";
import { pageTransition } from "./motionVariants";
import { archiveFontVariables } from "./fonts";
import type { ArchivePageId, CtxMenuTarget, FileFilter, FileType, FolderType } from "./types";
import tokens from "./tokens.module.css";
import styles from "./ArchiveShell.module.css";

const PAGES: Record<ArchivePageId, React.ComponentType> = {
  overview: OverviewPage,
  files: FilesPage,
  folders: FoldersPage,
  shared: SharedPage,
  trash: TrashPage,
  settings: SettingsPage,
};

export default function ArchiveShell() {
  const { status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";
  const reduceMotion = useReducedMotion();

  const [activePage, setActivePage] = useState<ArchivePageId>("overview");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("recent");
  const [filter, setFilter] = useState<FileFilter>("all");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [ctxMenuTarget, setCtxMenuTarget] = useState<CtxMenuTarget>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenuTarget) return;
    const handler = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenuTarget(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenuTarget]);

  const { data: dashboard, isLoading } = useQuery<{ files: FileType[]; folders: FolderType[] }>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const response = await fetch("/api/dashboard");
      if (!response.ok) throw new Error("Failed to load dashboard");
      return response.json();
    },
    enabled: isAuthenticated,
    refetchInterval: 15000,
  });

  const files = useMemo(() => dashboard?.files ?? [], [dashboard?.files]);
  const folders = useMemo(() => dashboard?.folders ?? [], [dashboard?.folders]);

  const currentFolderId = selectedFolderId;
  const selectedFolder = useMemo(() => folders.find((f) => f._id === selectedFolderId) ?? null, [folders, selectedFolderId]);

  const currentFolders = useMemo(
    () => folders.filter((f) => (f.parent_id ?? null) === currentFolderId),
    [folders, currentFolderId]
  );
  const rootFolders = useMemo(() => folders.filter((f) => (f.parent_id ?? null) === null), [folders]);

  const folderFileCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of files) {
      if (f.folderId) counts[f.folderId] = (counts[f.folderId] || 0) + 1;
    }
    return counts;
  }, [files]);

  const totalBytesUsed = useMemo(
    () => files.filter((f) => f.status === "uploaded").reduce((sum, f) => sum + (f.size || 0), 0),
    [files]
  );

  const fileActions = useFiles(files, folders);
  const folderActions = useFolders(folders, currentFolderId);
  const folderShare = useFolderShare();

  const sortFiles = (list: FileType[]) => {
    const copy = list.slice();
    switch (sortOrder) {
      case "name":
        return copy.sort((a, b) => a.filename.localeCompare(b.filename));
      case "size":
        return copy.sort((a, b) => (b.size || 0) - (a.size || 0));
      default:
        return copy.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
  };

  const visibleFiles = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = files.filter((f) => {
      if ((f.folderId ?? null) !== currentFolderId) return false;
      if (normalizedSearch && !f.filename.toLowerCase().includes(normalizedSearch)) return false;
      return matchesFilter(f.mimetype, filter);
    });
    return sortFiles(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, search, filter, sortOrder, currentFolderId]);

  const allFilteredFiles = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = files.filter((f) => {
      if (f.status !== "uploaded") return false;
      if (normalizedSearch && !f.filename.toLowerCase().includes(normalizedSearch)) return false;
      return matchesFilter(f.mimetype, filter);
    });
    return sortFiles(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, search, filter, sortOrder]);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const ok = await folderActions.createFolder(newFolderName.trim(), currentFolderId);
    if (ok) {
      setNewFolderName("");
      setShowNewFolder(false);
    }
  };

  const startRename = (folder: FolderType) => {
    setRenameId(folder._id);
    setRenameValue(folder.name);
  };

  const cancelRename = () => {
    setRenameId(null);
    setCtxMenuTarget(null);
  };

  const handleRenameSubmit = (folder: FolderType) => {
    if (renameValue.trim() && renameValue !== folder.name) {
      folderActions.renameFolder(folder, renameValue.trim());
    }
    setRenameId(null);
    setCtxMenuTarget(null);
  };

  const handleFolderContextMenu = (e: React.MouseEvent, folder: FolderType) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenuTarget({ type: "folder", item: folder, element: e.currentTarget as HTMLElement });
  };

  const handleFileContextMenu = (e: React.MouseEvent, file: FileType) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenuTarget({ type: "file", item: file, element: e.currentTarget as HTMLElement });
  };

  const openFolder = (folder: FolderType) => setSelectedFolderId(folder._id);
  const goBackToRoot = () => setSelectedFolderId(null);

  const value: ArchiveContextValue = {
    isLoading,
    files,
    folders,
    activePage,
    setActivePage,
    search,
    setSearch,
    sortOrder,
    setSortOrder,
    filter,
    setFilter,
    selectedFolderId,
    selectedFolder,
    currentFolderId,
    currentFolders,
    rootFolders,
    folderFileCounts,
    openFolder,
    goBackToRoot,
    visibleFiles,
    allFilteredFiles,
    totalBytesUsed,
    showNewFolder,
    setShowNewFolder,
    newFolderName,
    setNewFolderName,
    handleCreateFolder,
    renameId,
    renameValue,
    setRenameValue,
    startRename,
    handleRenameSubmit,
    cancelRename,
    ctxMenuTarget,
    setCtxMenuTarget,
    ctxMenuRef,
    handleFolderContextMenu,
    handleFileContextMenu,
    fileActions,
    folderActions,
    folderShare,
  };

  const ActivePageComponent = PAGES[activePage];
  const transition = pageTransition(reduceMotion);

  return (
    <ArchiveContext.Provider value={value}>
      <div className={`${tokens.archiveRoot} ${archiveFontVariables}`} style={{ fontFamily: "var(--font-public-sans), sans-serif" }}>
        <div className={styles.app}>
          <Sidebar />
          <main className={styles.main}>
            <TopBar />
            {isLoading ? (
              <div className={styles.loadingState}>Loading the archive…</div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div key={activePage} initial={transition.initial} animate={transition.animate} exit={transition.exit} transition={transition.transition}>
                  <ActivePageComponent />
                </motion.div>
              </AnimatePresence>
            )}
          </main>
        </div>

        <ContextMenu />
        <NewFolderModal />

        <ShareDialog
          fileTarget={fileActions.fileShareTarget}
          onCloseFile={() => fileActions.setFileShareTarget(null)}
          fileShareUrl={fileActions.fileShareUrl}
          fileShareCopied={fileActions.fileShareCopied}
          onCopyFileShareUrl={fileActions.copyFileShareUrl}
          folderTarget={folderShare.folderTarget}
          onCloseFolder={folderShare.closeFolderShare}
          access={folderShare.access}
          accessLoading={folderShare.accessLoading}
          newLinkUrl={folderShare.newLinkUrl}
          linkCopied={folderShare.linkCopied}
          busy={folderShare.busy}
          onCopyLink={folderShare.copyLink}
          onShareWithUser={folderShare.shareWithUser}
          onCreateLink={folderShare.createLink}
          onRevokeGrant={folderShare.revokeGrant}
          onRevokeLink={folderShare.revokeLink}
        />
        <DeleteDialog
          deleteTarget={fileActions.deleteTarget as any}
          setDeleteTarget={fileActions.setDeleteTarget as any}
          onDelete={async () => {
            if (!fileActions.deleteTarget) return;
            if (fileActions.deleteTarget.type === "file") {
              await fileActions.deleteFile(fileActions.deleteTarget.item._id);
            } else {
              await fileActions.deleteFolder(fileActions.deleteTarget.item._id);
            }
            fileActions.setDeleteTarget(null);
          }}
        />
        <MoveDialog
          moveTarget={fileActions.moveTarget as any}
          setMoveTarget={fileActions.setMoveTarget as any}
          folders={folders}
          uploadedFiles={files.filter((f) => f.status === "uploaded")}
          currentFolderId={currentFolderId}
          newFolderName={newFolderName}
          setNewFolderName={setNewFolderName}
          onCreateFolder={async () => {
            if (!newFolderName.trim()) return;
            await folderActions.createFolder(newFolderName.trim(), null);
            setNewFolderName("");
          }}
          onMove={async (targetFolderId) => {
            if (fileActions.moveTarget) {
              await fileActions.moveFile(fileActions.moveTarget, targetFolderId);
            }
            fileActions.setMoveTarget(null);
          }}
        />
        <VersionsDialog
          versionTarget={fileActions.versionTarget}
          setVersionTarget={fileActions.setVersionTarget}
          versions={fileActions.versions}
          versionsLoading={fileActions.versionsLoading}
          onOpenVersion={fileActions.openVersionUrl}
        />
      </div>
    </ArchiveContext.Provider>
  );
}
