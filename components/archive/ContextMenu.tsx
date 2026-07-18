"use client";

import { useArchive } from "./ArchiveContext";
import styles from "./ContextMenu.module.css";

export default function ContextMenu() {
  const {
    ctxMenuTarget,
    setCtxMenuTarget,
    ctxMenuRef,
    renameId,
    renameValue,
    setRenameValue,
    startRename,
    handleRenameSubmit,
    cancelRename,
    folderShare,
    folderActions,
    fileActions,
  } = useArchive();

  if (!ctxMenuTarget) return null;

  const rect = ctxMenuTarget.element.getBoundingClientRect();
  const style: React.CSSProperties = {
    top: Math.min(rect.bottom + 4, window.innerHeight - 300),
    left: Math.min(rect.right - 176, window.innerWidth - 184),
  };

  if (ctxMenuTarget.type === "folder") {
    const folder = ctxMenuTarget.item;
    const isRenaming = renameId === folder._id;

    return (
      <div ref={ctxMenuRef} className={styles.menu} style={style}>
        {isRenaming ? (
          <div className={styles.renameWrap}>
            <input
              autoFocus
              className={styles.renameInput}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSubmit(folder);
                if (e.key === "Escape") cancelRename();
              }}
            />
            <div className={styles.renameActions}>
              <button type="button" className={styles.ok} onClick={() => handleRenameSubmit(folder)}>
                OK
              </button>
              <button type="button" onClick={cancelRename}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              className={styles.item}
              onClick={() => {
                folderShare.openFolderShare(folder);
                setCtxMenuTarget(null);
              }}
            >
              Share
            </button>
            <button type="button" className={styles.item} onClick={() => startRename(folder)}>
              Rename
            </button>
            <button
              type="button"
              className={`${styles.item} ${styles.danger}`}
              onClick={() => {
                folderActions.deleteFolder(folder._id);
                setCtxMenuTarget(null);
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>
    );
  }

  const file = ctxMenuTarget.item;
  return (
    <div ref={ctxMenuRef} className={styles.menu} style={style}>
      <button
        type="button"
        className={styles.item}
        onClick={() => {
          fileActions.openShareModal(file);
          setCtxMenuTarget(null);
        }}
      >
        Share
      </button>
      <button
        type="button"
        className={styles.item}
        onClick={() => {
          fileActions.setMoveTarget(file);
          setCtxMenuTarget(null);
        }}
      >
        Move
      </button>
      <button
        type="button"
        className={styles.item}
        onClick={() => {
          fileActions.openVersions(file);
          setCtxMenuTarget(null);
        }}
      >
        Version history
      </button>
      <button
        type="button"
        className={`${styles.item} ${styles.danger}`}
        onClick={() => {
          fileActions.setDeleteTarget({ type: "file", item: file });
          setCtxMenuTarget(null);
        }}
      >
        Delete
      </button>
    </div>
  );
}
