import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import FolderShareActions from "./FolderShareActions";
import SharePasswordGate from "./SharePasswordGate";

type ShareFile = {
  fileId: string;
  filename: string;
  mimetype: string;
  size: number;
  backend: string;
  downloadUrl: string;
};

type ShareSubfolder = { id: string; name: string };

type ShareData = {
  folderId: string;
  folderName: string;
  linkRole: "viewer" | "editor";
  canUpload: boolean;
  canCreateFolder: boolean;
  expiresAt: string;
  files: ShareFile[];
  subfolders: ShareSubfolder[];
};

type FetchResult =
  | { kind: "ok"; data: ShareData }
  | { kind: "requiresPassword" }
  | { kind: "notFound" };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getFileIcon(mimetype: string): string {
  if (mimetype.startsWith("image/")) return "🖼";
  if (mimetype.startsWith("video/")) return "🎬";
  if (mimetype.startsWith("audio/")) return "🎵";
  if (mimetype.includes("pdf")) return "📄";
  if (mimetype.includes("zip") || mimetype.includes("compressed")) return "🗜";
  if (mimetype.includes("word") || mimetype.includes("document")) return "📝";
  if (mimetype.includes("sheet") || mimetype.includes("excel")) return "📊";
  return "📁";
}

async function fetchShareData(token: string, folderId?: string): Promise<FetchResult> {
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
    // Server Components don't automatically forward the incoming request's
    // cookies to an outbound fetch — this is a separate HTTP call as far
    // as Next is concerned. Forward them explicitly so a password-gated
    // link's session cookie (set by SharePasswordGate's POST) is actually
    // sent, letting the browse call succeed without asking again.
    const cookieHeader = (await cookies()).getAll().map((c) => `${c.name}=${c.value}`).join("; ");

    const res = await fetch(`${base}/api/shared/${token}${qs}`, {
      cache: "no-store",
      headers: { cookie: cookieHeader },
    });
    if (res.status === 401) return { kind: "requiresPassword" };
    if (!res.ok) return { kind: "notFound" };
    return { kind: "ok", data: await res.json() };
  } catch {
    return { kind: "notFound" };
  }
}

export default async function FolderSharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ folderId?: string }>;
}) {
  const { token } = await params;
  const { folderId } = await searchParams;
  const result = await fetchShareData(token, folderId);

  if (result.kind === "requiresPassword") {
    return <SharePasswordGate token={token} />;
  }
  if (result.kind === "notFound") notFound();

  const data = result.data;
  const totalSize = data.files.reduce((acc, f) => acc + f.size, 0);
  const expiresDate = data.expiresAt
    ? new Date(data.expiresAt).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      })
    : "";

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
        .back-link {
          display: inline-block; font-size: 0.8rem; color: #6c8eff; text-decoration: none;
          margin-bottom: 14px;
        }
        .back-link:hover { text-decoration: underline; }
        .folder-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
        .folder-card {
          background: #13161e; border: 1px solid #252a38; border-radius: 12px;
          padding: 13px 16px; display: flex; align-items: center; gap: 12px;
          text-decoration: none; color: inherit; transition: border-color 0.15s;
        }
        .folder-card:hover { border-color: #6c8eff55; }
        .role-badge {
          display: inline-block; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.03em;
          text-transform: uppercase; padding: 2px 8px; border-radius: 99px; margin-left: 8px;
          background: rgba(108,142,255,0.12); color: #6c8eff; vertical-align: middle;
        }
      `}</style>

      <div className="page">
        <div className="badge">📁 Shared folder</div>
        {folderId && (
          <a className="back-link" href={`/share/folder/${token}`}>← Back to root</a>
        )}
        <h1>{data.folderName}<span className="role-badge">{data.linkRole}</span></h1>
        <p className="meta">
          <span>{data.subfolders.length} folder{data.subfolders.length !== 1 ? "s" : ""}</span>
          {" · "}
          <span>{data.files.length} file{data.files.length !== 1 ? "s" : ""}</span>
          {" · "}
          <span>{formatBytes(totalSize)}</span>
          {expiresDate && <>{" · "} Expires {expiresDate}</>}
        </p>

        <FolderShareActions token={token} canAdd={data.canUpload && data.canCreateFolder} folderId={data.folderId} />

        {data.subfolders.length > 0 && (
          <div className="folder-list">
            {data.subfolders.map((f) => (
              <a key={f.id} className="folder-card" href={`/share/folder/${token}?folderId=${f.id}`}>
                <div className="file-icon">📁</div>
                <div className="file-info">
                  <div className="file-name">{f.name}</div>
                </div>
              </a>
            ))}
          </div>
        )}

        {data.files.length === 0 && data.subfolders.length === 0 ? (
          <div className="empty">This folder is empty.</div>
        ) : data.files.length === 0 ? null : (
          <div className="file-list">
            {data.files.map((file) => (
              <div key={file.fileId} className="file-card">
                <div className="file-icon">{getFileIcon(file.mimetype)}</div>
                <div className="file-info">
                  <div className="file-name">{file.filename}</div>
                  <div className="file-meta">{formatBytes(file.size)}</div>
                </div>
                <div className="file-btns">
                  <a className="btn btn-view" href={file.downloadUrl} target="_blank" rel="noopener noreferrer">
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
          {expiresDate && <>This link expires on {expiresDate}. </>}Shared via your storage.
        </div>
      </div>
    </>
  );
}
