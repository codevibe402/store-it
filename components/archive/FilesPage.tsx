"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useArchive } from "./ArchiveContext";
import FileCard from "./FileCard";
import FilterChips from "./FilterChips";
import UploadPanel from "./UploadPanel";
import { matchesFilter } from "./utils";
import { staggerContainer } from "./motionVariants";
import type { FileFilter } from "./types";
import shared from "./PageShared.module.css";

export default function FilesPage() {
  const { files, filter, setFilter, sortOrder, setSortOrder, allFilteredFiles, handleFileContextMenu, fileActions } = useArchive();
  const reduceMotion = useReducedMotion();

  const uploaded = useMemo(() => files.filter((f) => f.status === "uploaded"), [files]);

  const chips = useMemo(() => {
    const defs: { id: FileFilter; label: string }[] = [
      { id: "all", label: "All" },
      { id: "images", label: "Images" },
      { id: "documents", label: "Documents" },
      { id: "videos", label: "Video" },
      { id: "archives", label: "Archives" },
    ];
    return defs.map((d) => ({ ...d, count: uploaded.filter((f) => matchesFilter(f.mimetype, d.id)).length }));
  }, [uploaded]);

  return (
    <div>
      <div className={shared.pageHead}>
        <div className={shared.eyebrow}>Index</div>
        <h1 className={shared.pageTitle}>All Files</h1>
        <p className={shared.pageDesc}>Every card in the catalog, sorted by the day it was filed.</p>
      </div>

      <div className={shared.headerRow}>
        <FilterChips chips={chips} active={filter} onChange={setFilter} />
        <select className={shared.sortSelect} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} aria-label="Sort files">
          <option value="recent">Recently filed</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
        </select>
      </div>

      <div style={{ marginBottom: 32 }}>
        <UploadPanel currentFolderId={null} />
      </div>

      {allFilteredFiles.length === 0 ? (
        <div className={shared.emptyNote}>No files match this view.</div>
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
    </div>
  );
}
