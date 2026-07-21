"use client";

import { memo, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useAuth } from "@/components/AuthProvider";
import { AlertCircle, CheckCircle, CloudUpload, FileText, RotateCcw, XCircle } from "lucide-react";
import { useUpload, UploadEntry } from "@/hooks/useUpload";
import { useResume } from "@/hooks/useResume";
import { removeQueueItem } from "@/client/lib/uploadQueueDB";
import { formatBytes } from "./utils";
import type { FileType } from "./types";
import styles from "./UploadPanel.module.css";

type UploadPanelProps = {
  currentFolderId?: string | null;
};

function UploadPanel({ currentFolderId = null }: UploadPanelProps) {
  // See the matching comment in ArchiveShell.tsx — the app's own JWT
  // session, not NextAuth's useSession(), is what actually gates access.
  const { isAuthenticated } = useAuth();

  const [currentFolderIdState, setCurrentFolderIdState] = useState<string | null>(currentFolderId ?? null);

  useEffect(() => {
    setCurrentFolderIdState(currentFolderId ?? null);
  }, [currentFolderId]);

  const uploadHook = useUpload(currentFolderIdState);
  const resumeHook = useResume();

  // uploadHook.cancelledIds is a plain ref (shared with useUpload's own
  // internals), so mutating it doesn't itself trigger a re-render — without
  // this, dismissing a pending-upload row wouldn't visibly disappear until
  // some unrelated re-render happened to occur (e.g. the next 15s dashboard
  // refetch), instead of instantly.
  const [, forceRerender] = useReducer((n) => n + 1, 0);

  const { data: dashboard } = useQuery<{ pendingFiles: FileType[] }>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    enabled: isAuthenticated,
    refetchInterval: 15000,
  });

  const pendingFiles = dashboard?.pendingFiles ?? [];
  const visiblePendingFiles = pendingFiles.filter((f) => !uploadHook.cancelledIds.current.has(f._id));

  // Dismisses every finished/stalled row across all three lists in one shot:
  // completed entries in the active upload list, finished "Resuming"
  // attempts, and untouched pending uploads — the last of which are also
  // cancelled server-side (one batched request) so they don't just hide
  // client-side and then reappear on the next dashboard refetch.
  const dismissAll = useCallback(async () => {
    for (const u of uploadHook.uploads) {
      if (u.status === "success" || u.status === "error" || u.status === "duplicate") {
        uploadHook.cancelSingleUpload(u.id);
        removeQueueItem(u.id).catch(() => {});
      }
    }

    for (const re of resumeHook.resumeEntries) {
      if (re.status === "success" || re.status === "error") {
        uploadHook.cancelledIds.current.add(re.fileId);
        resumeHook.dismissEntry(re.fileId);
      }
    }

    const dismissablePending = visiblePendingFiles.filter(
      (f) => !resumeHook.resumeEntries.find((re) => re.fileId === f._id)
    );
    if (dismissablePending.length > 0) {
      for (const f of dismissablePending) uploadHook.cancelledIds.current.add(f._id);
      forceRerender();
      try {
        await fetch("/api/files/telegram/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileIds: dismissablePending.map((f) => f._id) }),
        });
      } catch {}
    } else {
      forceRerender();
    }
  }, [uploadHook, resumeHook, visiblePendingFiles]);

  const hasDismissableItems =
    uploadHook.uploads.some((u) => u.status === "success" || u.status === "error" || u.status === "duplicate") ||
    resumeHook.resumeEntries.some((re) => re.status === "success" || re.status === "error") ||
    visiblePendingFiles.length > 0;

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (fileList: FileList, handles?: (FileSystemFileHandle | null)[]) => {
    for (let i = 0; i < fileList.length; i++) {
      uploadHook.handleFile(fileList[i], currentFolderIdState, handles?.[i] ?? undefined);
    }
  };

  useEffect(() => {
    uploadHook.restoreQueue(currentFolderIdState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBrowseClick = async () => {
    if (typeof showOpenFilePicker === "function") {
      try {
        const fileHandles = await showOpenFilePicker({ multiple: true });
        for (const fh of fileHandles) {
          const file = await fh.getFile();
          uploadHook.handleFile(file, currentFolderIdState, fh);
        }
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
      }
    }
    inputRef.current?.click();
  };

  const extractHandles = async (items: DataTransferItemList): Promise<(FileSystemFileHandle | null)[]> => {
    const handles: (FileSystemFileHandle | null)[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file" && typeof (items[i] as any).getAsFileSystemHandle === "function") {
        try {
          handles.push((await (items[i] as any).getAsFileSystemHandle()) as FileSystemFileHandle);
        } catch {
          handles.push(null);
        }
      } else {
        handles.push(null);
      }
    }
    return handles;
  };

  return (
    <div className={styles.panel}>
      <div
        className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) {
            const handles = await extractHandles(e.dataTransfer.items);
            handleFiles(e.dataTransfer.files, handles);
          }
        }}
        onClick={handleBrowseClick}
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            const fileList = e.target.files;
            if (fileList && fileList.length > 0) {
              handleFiles(fileList);
              e.target.value = "";
            }
          }}
        />
        <div className={styles.dzIcon}>
          <CloudUpload size={22} />
        </div>
        <div className={styles.dzTitle}>Drop a file into the archive</div>
        <div className={styles.dzSub}>
          or <span className={styles.browse}>browse</span>
        </div>
        <div className={styles.dzHint}>
          <span>Under 10&nbsp;MB: instant S3</span>
          <span>Large files: Telegram chunks</span>
        </div>
      </div>

      {hasDismissableItems && (
        <div className={styles.queueActions}>
          <button type="button" onClick={dismissAll}>
            Dismiss all
          </button>
        </div>
      )}

      {uploadHook.uploads.length > 0 && (
        <div>
          <div className={styles.queueTitle}>Uploads ({uploadHook.uploads.length})</div>
          <div className={styles.queueActions}>
            <button type="button" onClick={uploadHook.pauseUpload}>
              Pause all
            </button>
            <button type="button" onClick={uploadHook.cancelUpload}>
              Cancel all
            </button>
          </div>
          <div className={styles.panel}>
            {uploadHook.uploads.map((u) => (
              <UploadRow
                key={u.id}
                entry={u}
                onPause={() => uploadHook.pauseSingleUpload(u.id)}
                onResume={() => uploadHook.resumeSingleUpload(u.id)}
                onCancel={() => uploadHook.cancelSingleUpload(u.id)}
              />
            ))}
          </div>
        </div>
      )}

      {resumeHook.resumeEntries.length > 0 && (
        <div>
          <div className={styles.queueTitle}>Resuming ({resumeHook.resumeEntries.length})</div>
          <div className={styles.panel} style={{ marginTop: 10 }}>
            {resumeHook.resumeEntries.map((re) => {
              const pf = visiblePendingFiles.find((f) => f._id === re.fileId);
              return (
                <div key={re.fileId} className={styles.row}>
                  <div className={styles.rowInner}>
                    <div className={`${styles.rowIcon} ${styles.uploading}`}>
                      <RotateCcw size={18} />
                    </div>
                    <div className={styles.rowInfo}>
                      <div className={styles.rowName}>{re.filename}</div>
                      <div className={styles.rowMeta}>
                        {formatBytes(re.size)}
                        {re.status === "resuming" && <span> · {re.progress}%</span>}
                        {re.status === "paused" && <span className={styles.paused}>Paused</span>}
                        {re.status === "success" && <span className={styles.success}>Uploaded</span>}
                      </div>
                      {(re.status === "resuming" || re.status === "paused") && (
                        <div className={styles.progressTrack}>
                          <div className={styles.progressFill} style={{ width: `${Math.max(0, re.progress)}%` }} />
                        </div>
                      )}
                      {re.status === "error" && re.error && <div className={styles.rowError}>{re.error}</div>}
                    </div>
                    <div className={styles.rowActions}>
                      {re.status === "resuming" && pf && (
                        <button type="button" onClick={() => resumeHook.pauseSingleResume(pf)}>
                          Pause
                        </button>
                      )}
                      {re.status === "paused" && pf && (
                        <button type="button" onClick={() => resumeHook.startResume(pf)}>
                          Resume
                        </button>
                      )}
                      {pf && (
                        <button type="button" className={styles.danger} onClick={() => resumeHook.cancelResume(pf)}>
                          Cancel
                        </button>
                      )}
                      {(re.status === "success" || re.status === "error") && (
                        <button
                          type="button"
                          onClick={() => {
                            // Both halves matter: dismissEntry removes this row from
                            // the "Resuming" list; cancelledIds keeps the same file
                            // from popping back up in "Pending uploads" right after
                            // (it's excluded from that list only while it has a
                            // tracked resume entry).
                            uploadHook.cancelledIds.current.add(re.fileId);
                            resumeHook.dismissEntry(re.fileId);
                          }}
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {visiblePendingFiles.length > 0 && (
        <div>
          <div className={styles.queueTitle}>Pending uploads</div>
          <div className={styles.panel} style={{ marginTop: 10 }}>
            {visiblePendingFiles
              .filter((f) => !resumeHook.resumeEntries.find((re) => re.fileId === f._id))
              .map((file) => (
                <div key={file._id} className={styles.row}>
                  <div className={styles.rowInner}>
                    <div className={`${styles.rowIcon} ${styles.duplicate}`}>
                      <FileText size={18} />
                    </div>
                    <div className={styles.rowInfo}>
                      <div className={styles.rowName}>{file.filename}</div>
                      <div className={styles.rowMeta}>
                        {formatBytes(file.size)} · Status: {file.status}
                      </div>
                    </div>
                    <div className={styles.rowActions}>
                      <button type="button" onClick={() => resumeHook.startResume(file)}>
                        Resume
                      </button>
                      <button
                        type="button"
                        className={styles.danger}
                        onClick={async () => {
                          uploadHook.cancelledIds.current.add(file._id);
                          forceRerender();
                          try {
                            await fetch("/api/files/telegram/cancel", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ fileId: file._id }),
                            });
                          } catch {}
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Upload state must survive whatever else the archive UI is doing — search,
// sort, filter, context menus — none of that touches currentFolderId, the
// only prop this takes. Without memo, every keystroke in search re-renders
// FilesPage/FoldersPage (via the shared ArchiveContext value changing
// identity), which re-renders this and every UploadRow underneath it as a
// side effect, competing with the upload loop's own async work for the main
// thread. memo makes that structurally impossible: this only re-renders
// when currentFolderId itself changes.
export default memo(UploadPanel);

function UploadRow({
  entry,
  onPause,
  onResume,
  onCancel,
}: {
  entry: UploadEntry;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const inProgress = entry.status === "uploading" || entry.status === "paused";
  const kind =
    entry.status === "success" ? "success" : entry.status === "error" ? "error" : entry.status === "duplicate" ? "duplicate" : "uploading";

  return (
    <div className={styles.row}>
      <div className={styles.rowInner}>
        <div className={`${styles.rowIcon} ${styles[kind]}`}>
          {entry.status === "success" ? (
            <CheckCircle size={18} />
          ) : entry.status === "error" ? (
            <XCircle size={18} />
          ) : entry.status === "duplicate" ? (
            <AlertCircle size={18} />
          ) : (
            <FileText size={18} />
          )}
        </div>

        <div className={styles.rowInfo}>
          <div className={styles.rowName}>{entry.filename}</div>
          <div className={styles.rowMeta}>
            {formatBytes(entry.size)}
            {inProgress && <span> · {entry.progress}%</span>}
            {entry.status === "paused" && <span className={styles.paused}>Paused</span>}
            {entry.status === "success" && <span className={styles.success}>Uploaded</span>}
            {entry.status === "duplicate" && <span className={styles.duplicate}>Duplicate</span>}
          </div>

          {inProgress && (
            <div className={styles.progressTrack}>
              <motion.div
                className={styles.progressFill}
                animate={{ width: `${entry.progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          )}

          {entry.status === "error" && entry.error && <div className={styles.rowError}>{entry.error}</div>}
        </div>

        {entry.status === "uploading" && (
          <div className={styles.rowActions}>
            <button type="button" onClick={onPause}>
              Pause
            </button>
            <button type="button" className={styles.danger} onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}

        {entry.status === "paused" && (
          <div className={styles.rowActions}>
            <button type="button" onClick={onResume}>
              Resume
            </button>
            <button type="button" className={styles.danger} onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}

        {(entry.status === "success" || entry.status === "error" || entry.status === "duplicate") && (
          <div className={styles.rowActions}>
            <button
              type="button"
              onClick={() => {
                onCancel();
                removeQueueItem(entry.id).catch(() => {});
              }}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
