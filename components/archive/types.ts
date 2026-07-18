export type FileType = {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  hash?: string;
  storageUrl: string;
  owner_id: string;
  status: "pending" | "uploading" | "paused" | "fallback_cleanup" | "s3_pending" | "uploaded" | "cancelled" | "failed";
  folderId: string | null;
  createdAt: string;
  backend?: "s3" | "telegram";
};

export type FolderType = {
  _id: string;
  name: string;
  owner_id: string;
  parent_id?: string | null;
  createdAt: string;
};

export type FileFilter = "all" | "images" | "videos" | "documents" | "archives";

export type CtxMenuTarget =
  | { type: "folder"; item: FolderType; element: HTMLElement }
  | { type: "file"; item: FileType; element: HTMLElement }
  | null;

export type ArchivePageId = "overview" | "files" | "folders" | "shared" | "trash" | "settings";
