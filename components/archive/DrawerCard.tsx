"use client";

import { motion, useReducedMotion } from "framer-motion";
import { FolderIcon, MoreHorizontal, Plus } from "lucide-react";
import { riseItem } from "./motionVariants";
import type { FolderType } from "./types";
import styles from "./DrawerCard.module.css";

type DrawerCardProps = {
  folder: FolderType;
  fileCount: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent, folder: FolderType) => void;
};

export function DrawerCard({ folder, fileCount, onClick, onContextMenu }: DrawerCardProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={styles.drawer}
      variants={riseItem(reduceMotion)}
      whileHover={reduceMotion ? undefined : { y: -4, borderColor: "var(--brass)" }}
      whileTap={reduceMotion ? undefined : { scale: 0.98 }}
      transition={{ duration: 0.16 }}
      onClick={onClick}
      onContextMenu={(e) => onContextMenu(e, folder)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className={styles.top}>
        <FolderIcon className={styles.icon} strokeWidth={1.5} />
        <button
          type="button"
          className={styles.menuBtn}
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(e, folder);
          }}
          aria-label={`More options for ${folder.name}`}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
      <div className={styles.name}>{folder.name}</div>
      <div className={styles.count}>{fileCount === 0 ? "empty drawer" : `${fileCount} file${fileCount === 1 ? "" : "s"}`}</div>
    </motion.div>
  );
}

export function AddDrawerCard({ onClick }: { onClick: () => void }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.button
      type="button"
      className={styles.addNew}
      variants={riseItem(reduceMotion)}
      whileHover={reduceMotion ? undefined : { y: -4 }}
      whileTap={reduceMotion ? undefined : { scale: 0.98 }}
      onClick={onClick}
    >
      <Plus />
      <span>New Drawer</span>
    </motion.button>
  );
}
