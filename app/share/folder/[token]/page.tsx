import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import FolderShareActions from "./FolderShareActions";
import SharePasswordGate from "./SharePasswordGate";
import ShareFolderContents from "@/components/archive/ShareFolderContents";
import { archiveFontVariables } from "@/components/archive/fonts";
import tokens from "@/components/archive/tokens.module.css";
import styles from "@/components/archive/ShareFolderBrowser.module.css";
import { formatBytes } from "@/components/archive/utils";

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
    <div className={`${tokens.archiveRoot} ${archiveFontVariables}`} style={{ fontFamily: "var(--font-public-sans), sans-serif" }}>
      <div className={styles.page}>
        <div className={styles.badge}>Shared drawer</div>
        {folderId && (
          <a className={styles.backLink} href={`/share/folder/${token}`}>← Back to root</a>
        )}
        <h1 className={styles.title}>
          {data.folderName}
          <span className={styles.roleBadge}>{data.linkRole}</span>
        </h1>
        <p className={styles.meta}>
          {data.subfolders.length} folder{data.subfolders.length !== 1 ? "s" : ""}
          {" · "}
          {data.files.length} file{data.files.length !== 1 ? "s" : ""}
          {" · "}
          {formatBytes(totalSize)}
          {expiresDate && <> · Expires {expiresDate}</>}
        </p>

        <FolderShareActions token={token} canAdd={data.canUpload && data.canCreateFolder} folderId={data.folderId} />

        {data.subfolders.length === 0 && data.files.length === 0 ? (
          <div className={styles.footer}>This folder is empty.</div>
        ) : (
          <ShareFolderContents token={token} subfolders={data.subfolders} files={data.files} />
        )}

        <div className={styles.footer}>
          {expiresDate && <>This link expires on {expiresDate}. </>}Shared via your storage.
        </div>
      </div>
    </div>
  );
}
