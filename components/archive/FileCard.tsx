"use client";

import { motion, useReducedMotion } from "framer-motion";
import { File, FileText, Image as ImageIcon, MoreHorizontal, Video } from "lucide-react";
import { fileKind, formatBytes, formatDate } from "./utils";
import { riseItem } from "./motionVariants";
import type { FileType } from "./types";
import styles from "./FileCard.module.css";

type FileCardProps = {
  file: FileType;
  onOpen: (file: FileType) => void;
  onDownload: (file: FileType) => void;
  onContextMenu: (e: React.MouseEvent, file: FileType) => void;
};

function KindIcon({ kind }: { kind: ReturnType<typeof fileKind> }) {
  if (kind === "image") return <ImageIcon />;
  if (kind === "video") return <Video />;
  if (kind === "doc") return <FileText />;
  return <File />;
}

export default function FileCard({ file, onOpen, onDownload, onContextMenu }: FileCardProps) {
  const reduceMotion = useReducedMotion();
  const kind = fileKind(file.mimetype);

  return (
    <motion.div
      className={styles.fileCard}
      variants={riseItem(reduceMotion)}
      whileHover={reduceMotion ? undefined : { x: 3 }}
      transition={{ duration: 0.15 }}
      onContextMenu={(e) => onContextMenu(e, file)}
    >
      <span className={`${styles.flag} ${styles[kind]}`} />
      <div className={`${styles.icon} ${styles[kind]}`}>
        <KindIcon kind={kind} />
      </div>
      <div className={styles.meta}>
        <div className={styles.name}>{file.filename}</div>
        <div className={styles.sub}>
          {formatBytes(file.size)} · Filed {formatDate(file.createdAt)}
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.linkBtn} onClick={() => onOpen(file)}>
          Preview
        </button>
        <button type="button" className={styles.linkBtn} onClick={() => onDownload(file)}>
          Download
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={(e) => onContextMenu(e, file)}
          aria-label={`More options for ${file.filename}`}
        >
          <MoreHorizontal />
        </button>
      </div>
    </motion.div>
  );
}
