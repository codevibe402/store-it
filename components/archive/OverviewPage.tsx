"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useArchive } from "./ArchiveContext";
import { DrawerCard, AddDrawerCard } from "./DrawerCard";
import FileCard from "./FileCard";
import { formatBytes } from "./utils";
import { staggerContainer } from "./motionVariants";
import shared from "./PageShared.module.css";

export default function OverviewPage() {
  const {
    files,
    folders,
    rootFolders,
    folderFileCounts,
    totalBytesUsed,
    search,
    setActivePage,
    setShowNewFolder,
    setNewFolderName,
    openFolder,
    handleFolderContextMenu,
    handleFileContextMenu,
    fileActions,
  } = useArchive();
  const reduceMotion = useReducedMotion();

  const normalizedSearch = search.trim().toLowerCase();
  const isSearching = normalizedSearch.length > 0;

  const recentFiles = useMemo(() => {
    const matches = files
      .filter((f) => f.status === "uploaded")
      .filter((f) => !normalizedSearch || f.filename.toLowerCase().includes(normalizedSearch))
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return isSearching ? matches : matches.slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, normalizedSearch]);

  const eyebrowDate = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div>
      <div className={shared.pageHead}>
        <div className={shared.eyebrow}>Ledger — {eyebrowDate}</div>
        <h1 className={shared.pageTitle}>Your Archive</h1>
        <p className={shared.pageDesc}>
          {isSearching
            ? `${recentFiles.length} file${recentFiles.length === 1 ? "" : "s"} matching "${search.trim()}".`
            : `Everything you've filed, at a glance. ${rootFolders.length} drawer${rootFolders.length === 1 ? "" : "s"}, ${recentFiles.length} recent entr${recentFiles.length === 1 ? "y" : "ies"}.`}
        </p>
      </div>

      <div className={shared.statStrip}>
        <div className={shared.statCell}>
          <div className={shared.statLabel}>Storage Used</div>
          <div className={shared.meterNum}>
            {(totalBytesUsed / (1024 * 1024 * 1024)).toFixed(1)}
            <span className={shared.meterUnit}> GB</span>
          </div>
          <div className={shared.meterSub}>{formatBytes(totalBytesUsed)} filed in total</div>
        </div>
        <div className={shared.statCell}>
          <div className={shared.statLabel}>Total Files</div>
          <div className={shared.statNum}>{files.filter((f) => f.status === "uploaded").length}</div>
        </div>
        <div className={shared.statCell}>
          <div className={shared.statLabel}>Folders</div>
          <div className={`${shared.statNum} ${shared.blue}`}>{folders.length}</div>
        </div>
      </div>

      <div className={shared.sectionHead}>
        <h2 className={shared.sectionTitle}>Your drawers</h2>
        <button type="button" className={shared.sectionLink} onClick={() => setActivePage("folders")}>
          Open all folders →
        </button>
      </div>
      <motion.div
        className={shared.drawerGrid}
        initial="hidden"
        animate="show"
        variants={staggerContainer(0.06, reduceMotion)}
      >
        {rootFolders.map((folder) => (
          <DrawerCard
            key={folder._id}
            folder={folder}
            fileCount={folderFileCounts[folder._id] || 0}
            onClick={() => {
              openFolder(folder);
              setActivePage("folders");
            }}
            onContextMenu={handleFolderContextMenu}
          />
        ))}
        <AddDrawerCard
          onClick={() => {
            setNewFolderName("");
            setShowNewFolder(true);
          }}
        />
      </motion.div>

      <div className={shared.sectionHead}>
        <h2 className={shared.sectionTitle}>{isSearching ? `Matching "${search.trim()}"` : "Recently filed"}</h2>
        <button type="button" className={shared.sectionLink} onClick={() => setActivePage("files")}>
          View all →
        </button>
      </div>
      {recentFiles.length === 0 ? (
        <div className={shared.emptyNote}>{isSearching ? "No files match your search." : "Nothing filed yet."}</div>
      ) : (
        <motion.div className={shared.fileList} initial="hidden" animate="show" variants={staggerContainer(0.04, reduceMotion)}>
          {recentFiles.map((file) => (
            <FileCard
              key={file._id}
              file={file}
              onOpen={fileActions.openFile}
              onDownload={fileActions.downloadFile}
              onContextMenu={handleFileContextMenu}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}
