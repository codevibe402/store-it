// app/share/folder/[token]/page.tsx
// Public route — no authentication required.
import { notFound } from "next/navigation";
import connectDB from "@/lib/mongoose";
import FolderShare from "@/models/Foldershare";
import FolderShareActions from "./FolderShareActions";

type ShareFile = {
  fileId:      string;
  filename:    string;
  mimetype:    string;
  size:        number;
  url:         string;
  downloadUrl: string;
};

type ShareDoc = {
  token:      string;
  folderName: string;
  owner_id:   string;
  permission: "read" | "add";
  files:      ShareFile[];
  expiresAt:  Date;
  createdAt:  Date;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024)                  return `${bytes} B`;
  if (bytes < 1024 * 1024)          return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)   return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getFileIcon(mimetype: string): string {
  if (mimetype.startsWith("image/"))                              return "🖼";
  if (mimetype.startsWith("video/"))                             return "🎬";
  if (mimetype.startsWith("audio/"))                             return "🎵";
  if (mimetype.includes("pdf"))                                  return "📄";
  if (mimetype.includes("zip") || mimetype.includes("compressed")) return "🗜";
  if (mimetype.includes("word") || mimetype.includes("document")) return "📝";
  if (mimetype.includes("sheet") || mimetype.includes("excel"))  return "📊";
  return "📁";
}

export default async function FolderSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  // Ensure Mongoose is connected before querying the model
  await connectDB();

  const { token } = await params;

  const share = (await FolderShare.findOne({
    token,
    expiresAt: { $gt: new Date() },
  }).lean()) as ShareDoc | null;

  if (!share) notFound();

  const totalSize   = share.files.reduce((acc, f) => acc + f.size, 0);
  const expiresDate = new Date(share.expiresAt).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'DM Sans', sans-serif;
          background: #0d0f14; color: #e8eaf0; min-height: 100vh; padding: 48px 24px;
        }
        .page  { max-width: 640px; margin: 0 auto; }
        .badge {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 0.72rem; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase;
          background: rgba(108,142,255,0.12); border: 1px solid rgba(108,142,255,0.25);
          color: #6c8eff; padding: 4px 10px; border-radius: 99px; margin-bottom: 20px;
        }
        h1 {
          font-family: 'Syne', sans-serif; font-size: 1.8rem; font-weight: 800;
          letter-spacing: -0.03em; margin-bottom: 6px;
        }
        .meta  { font-size: 0.82rem; color: #6b7280; margin-bottom: 28px; }
        .meta span { color: #9ca3af; }
        .file-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 32px; }
        .file-card {
          background: #13161e; border: 1px solid #252a38; border-radius: 12px;
          padding: 13px 16px; display: flex; align-items: center; gap: 12px;
          transition: border-color 0.15s;
        }
        .file-card:hover { border-color: #353c52; }
        .file-icon {
          font-size: 20px; width: 38px; height: 38px; background: #1a1e28;
          border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .file-info  { flex: 1; overflow: hidden; }
        .file-name  { font-size: 0.875rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .file-meta  { font-size: 0.7rem; color: #6b7280; margin-top: 2px; }
        .file-btns  { display: flex; gap: 6px; flex-shrink: 0; }
        .btn {
          padding: 5px 12px; border-radius: 7px; font-family: 'DM Sans', sans-serif;
          font-size: 0.75rem; font-weight: 500; cursor: pointer; transition: all 0.15s;
          text-decoration: none; display: inline-flex; align-items: center; gap: 4px;
        }
        .btn-view {
          background: rgba(108,142,255,0.1); border: 1px solid rgba(108,142,255,0.25); color: #6c8eff;
        }
        .btn-view:hover { background: rgba(108,142,255,0.2); }
        .btn-dl {
          background: #1a1e28; border: 1px solid #252a38; color: #9ca3af;
        }
        .btn-dl:hover { background: #252a38; color: #e8eaf0; }
        .footer {
          text-align: center; font-size: 0.78rem; color: #4b5563;
          border-top: 1px solid #1a1e28; padding-top: 24px;
        }
        .empty { text-align: center; padding: 48px 0; color: #6b7280; font-size: 0.9rem; }
        .share-add-panel {
          background: #13161e; border: 1px solid #2f6f5f; border-radius: 14px;
          padding: 16px; display: flex; flex-direction: column; gap: 14px; margin-bottom: 22px;
        }
        .share-add-title { font-size: 0.9rem; font-weight: 700; color: #34d399; }
        .share-add-sub { font-size: 0.78rem; color: #9ca3af; margin-top: 3px; }
        .share-add-actions { display: flex; gap: 10px; flex-wrap: wrap; }
        .share-add-btn, .share-folder-form button {
          background: rgba(52,211,153,0.12); border: 1px solid rgba(52,211,153,0.35);
          color: #34d399; border-radius: 8px; padding: 8px 12px; font-size: 0.78rem;
          cursor: pointer; font-weight: 600;
        }
        .share-folder-form { display: flex; gap: 8px; flex: 1; min-width: 240px; }
        .share-folder-form input {
          flex: 1; background: #1a1e28; border: 1px solid #252a38; color: #e8eaf0;
          border-radius: 8px; padding: 8px 10px; min-width: 0;
        }
        .share-add-message { font-size: 0.78rem; color: #fbbf24; }
      `}</style>

      <div className="page">
        <div className="badge">📁 Shared folder</div>
        <h1>{share.folderName}</h1>
        <p className="meta">
          <span>{share.files.length} file{share.files.length !== 1 ? "s" : ""}</span>
          {" · "}
          <span>{formatBytes(totalSize)}</span>
          {" · "}
          Expires {expiresDate}
        </p>

        <FolderShareActions token={share.token} canAdd={share.permission === "add"} />

        {share.files.length === 0 ? (
          <div className="empty">This folder is empty.</div>
        ) : (
          <div className="file-list">
            {share.files.map((file) => (
              <div key={file.fileId} className="file-card">
                <div className="file-icon">{getFileIcon(file.mimetype)}</div>
                <div className="file-info">
                  <div className="file-name">{file.filename}</div>
                  <div className="file-meta">{formatBytes(file.size)}</div>
                </div>
                <div className="file-btns">
                  <a className="btn btn-view" href={file.url} target="_blank" rel="noopener noreferrer">
                    View ↗
                  </a>
                  <a className="btn btn-dl" href={file.downloadUrl} download={file.filename}>
                    ⬇ Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="footer">
          This link expires on {expiresDate}. Shared via your storage.
        </div>
      </div>
    </>
  );
}
