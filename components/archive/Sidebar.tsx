"use client";

import { motion } from "framer-motion";
import { LayoutGrid, FileText, FolderIcon, Share2, Trash2, Settings as SettingsIcon } from "lucide-react";
import { useArchive } from "./ArchiveContext";
import StorageGauge from "./StorageGauge";
import type { ArchivePageId } from "./types";
import styles from "./Sidebar.module.css";

const TABS: { id: ArchivePageId; label: string; icon: React.ComponentType<{ size?: number }>; count?: (n: { files: number; folders: number }) => number }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "files", label: "Files", icon: FileText, count: (n) => n.files },
  { id: "folders", label: "Folders", icon: FolderIcon, count: (n) => n.folders },
  { id: "shared", label: "Shared", icon: Share2 },
  { id: "trash", label: "Trash", icon: Trash2 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

export default function Sidebar() {
  const { activePage, setActivePage, files, folders, totalBytesUsed } = useArchive();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.brandMark}>S</div>
        <div>
          <div className={styles.brandName}>StoreIt</div>
          <div className={styles.brandSub}>Personal Archive</div>
        </div>
      </div>

      <nav className={styles.tabs}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activePage === tab.id;
          const count = tab.count?.({ files: files.length, folders: folders.length });
          return (
            <button
              key={tab.id}
              type="button"
              className={`${styles.tabItem} ${isActive ? styles.active : ""}`}
              onClick={() => setActivePage(tab.id)}
              aria-current={isActive ? "page" : undefined}
            >
              {isActive && (
                <motion.span layoutId="nav-active-pill" className={styles.activePill} transition={{ type: "spring", stiffness: 380, damping: 34 }} />
              )}
              <Icon size={17} />
              <span className={styles.tabLabel}>{tab.label}</span>
              {typeof count === "number" && count > 0 && <span className={styles.count}>{count}</span>}
            </button>
          );
        })}
      </nav>

      <div className={styles.sidebarFoot}>
        <div className={styles.gaugeWrap}>
          <StorageGauge totalBytes={totalBytesUsed} />
        </div>
      </div>
    </aside>
  );
}
