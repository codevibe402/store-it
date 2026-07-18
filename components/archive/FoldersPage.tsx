"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useArchive } from "./ArchiveContext";
import { DrawerCard, AddDrawerCard } from "./DrawerCard";
import FileCard from "./FileCard";
import UploadPanel from "./UploadPanel";
import { staggerContainer } from "./motionVariants";
import shared from "./PageShared.module.css";

export default function FoldersPage() {
  const {
    selectedFolder,
    currentFolders,
    rootFolders,
    folderFileCounts,
    visibleFiles,
    allFilteredFiles,
    search,
    openFolder,
    goBackToRoot,
    handleFolderContextMenu,
    handleFileContextMenu,
    fileActions,
    setShowNewFolder,
    setNewFolderName,
  } = useArchive();
  const reduceMotion = useReducedMotion();

  const drawerList = selectedFolder ? currentFolders : rootFolders;
  const isSearching = search.trim().length > 0;

  return (
    <div>
      <div className={shared.pageHead}>
        <div className={shared.eyebrow}>Cabinet</div>
        <h1 className={shared.pageTitle}>Folders</h1>
        <p className={shared.pageDesc}>Pull open a drawer to see what&apos;s filed inside.</p>
      </div>

      {selectedFolder && (
        <>
          <button type="button" className={shared.backLink} onClick={goBackToRoot}>
            <ArrowLeft size={14} /> Back to all folders
          </button>
          <h2 className={shared.folderHeading}>{selectedFolder.name}</h2>
        </>
      )}

      {drawerList.length > 0 && (
        <motion.div
          className={shared.drawerGrid}
          initial="hidden"
          animate="show"
          variants={staggerContainer(0.06, reduceMotion)}
          style={{ marginBottom: 40 }}
        >
          {drawerList.map((folder) => (
            <DrawerCard
              key={folder._id}
              folder={folder}
              fileCount={folderFileCounts[folder._id] || 0}
              onClick={() => openFolder(folder)}
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
      )}

      {!selectedFolder && isSearching && (
        <>
          <div className={shared.sectionHead}>
            <h2 className={shared.sectionTitle}>Matching &quot;{search.trim()}&quot;</h2>
          </div>
          {allFilteredFiles.length === 0 ? (
            <div className={shared.emptyNote}>No files match your search.</div>
          ) : (
            <motion.div className={shared.fileList} initial="hidden" animate="show" variants={staggerContainer(0.04, reduceMotion)}>
              {allFilteredFiles.map((file) => (
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
        </>
      )}

      {selectedFolder && (
        <>
          <div className={shared.sectionHead}>
            <h2 className={shared.sectionTitle}>Files in {selectedFolder.name}</h2>
          </div>

          <div style={{ marginBottom: 24 }}>
            <UploadPanel currentFolderId={selectedFolder._id} />
          </div>

          {visibleFiles.length === 0 ? (
            <div className={shared.emptyNote}>This drawer is empty.</div>
          ) : (
            <motion.div className={shared.fileList} initial="hidden" animate="show" variants={staggerContainer(0.04, reduceMotion)}>
              {visibleFiles.map((file) => (
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
        </>
      )}
    </div>
  );
}
