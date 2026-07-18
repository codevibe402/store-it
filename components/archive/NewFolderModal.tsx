"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useArchive } from "./ArchiveContext";
import styles from "./NewFolderModal.module.css";

export default function NewFolderModal() {
  const { showNewFolder, setShowNewFolder, newFolderName, setNewFolderName, handleCreateFolder } = useArchive();

  return (
    <AnimatePresence>
      {showNewFolder && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setShowNewFolder(false)}
        >
          <motion.div
            className={styles.panel}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={styles.title}>Label a new drawer</h3>
            <input
              autoFocus
              className={styles.input}
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
              }}
            />
            <div className={styles.actions}>
              <motion.button
                type="button"
                className={styles.primary}
                whileTap={{ scale: 0.97 }}
                onClick={handleCreateFolder}
              >
                Create
              </motion.button>
              <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={() => setShowNewFolder(false)}>
                Cancel
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
