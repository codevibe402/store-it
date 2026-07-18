import Link from "next/link";
import { File, FileText, FolderIcon, Image as ImageIcon, Video } from "lucide-react";
import { fileKind, formatBytes } from "./utils";
import styles from "./ShareFolderBrowser.module.css";

type ShareFile = {
  fileId: string;
  filename: string;
  mimetype: string;
  size: number;
  backend: string;
  downloadUrl: string;
};

type ShareSubfolder = { id: string; name: string };

function KindIcon({ kind }: { kind: ReturnType<typeof fileKind> }) {
  if (kind === "image") return <ImageIcon />;
  if (kind === "video") return <Video />;
  if (kind === "doc") return <FileText />;
  return <File />;
}

export default function ShareFolderContents({
  token,
  subfolders,
  files,
}: {
  token: string;
  subfolders: ShareSubfolder[];
  files: ShareFile[];
}) {
  return (
    <>
      {subfolders.length > 0 && (
        <>
          <h2 className={styles.sectionLabel}>Drawers</h2>
          <div className={styles.drawerGrid}>
            {subfolders.map((f) => (
              <Link key={f.id} className={styles.drawer} href={`/share/folder/${token}?folderId=${f.id}`}>
                <FolderIcon className={styles.drawerIcon} strokeWidth={1.5} />
                <div className={styles.drawerName}>{f.name}</div>
              </Link>
            ))}
          </div>
        </>
      )}

      {files.length > 0 && (
        <>
          <h2 className={styles.sectionLabel}>Files</h2>
          <div className={styles.fileList}>
            {files.map((file) => {
              const kind = fileKind(file.mimetype);
              return (
                <div key={file.fileId} className={styles.fileCard}>
                  <span className={`${styles.flag} ${styles[kind]}`} />
                  <div className={`${styles.fileIcon} ${styles[kind]}`}>
                    <KindIcon kind={kind} />
                  </div>
                  <div className={styles.fileMeta}>
                    <div className={styles.fileName}>{file.filename}</div>
                    <div className={styles.fileSub}>{formatBytes(file.size)}</div>
                  </div>
                  <div className={styles.fileActions}>
                    <a href={file.downloadUrl} target="_blank" rel="noopener noreferrer">
                      View ↗
                    </a>
                    <a href={file.downloadUrl} download={file.filename}>
                      Download
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
