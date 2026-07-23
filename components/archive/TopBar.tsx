"use client";

import { motion } from "framer-motion";
import { useAuth } from "@/components/AuthProvider";
import { FolderPlus, Search, Upload } from "lucide-react";
import { useArchive } from "./ArchiveContext";
import styles from "./TopBar.module.css";

export default function TopBar() {
  const { search, setSearch, setShowNewFolder, setNewFolderName, setActivePage } = useArchive();
  const { user } = useAuth();

  const initial = (user?.email || "S").trim().charAt(0).toUpperCase();

  return (
    <div className={styles.topbar}>
      <label className={styles.searchWrap}>
        <span className="sr-only">Search the archive</span>
        <Search className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search the archive…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className={styles.right}>
        <motion.button
          type="button"
          className={styles.btn}
          whileTap={{ scale: 0.97 }}
          onClick={() => {
            setNewFolderName("");
            setShowNewFolder(true);
          }}
        >
          <FolderPlus />
          New Folder
        </motion.button>
        <motion.button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          whileHover={{ filter: "brightness(1.08)" }}
          whileTap={{ scale: 0.97 }}
          onClick={() => setActivePage("files")}
        >
          <Upload />
          Upload
        </motion.button>
        <div className={styles.avatar}>{initial}</div>
      </div>
    </div>
  );
}
