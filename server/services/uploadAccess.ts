import { resolveFolderPermission, atLeast } from "@/server/services/permissionService";

export { resolveFolderPermission, atLeast };

type UploadableFile = {
  owner_id: unknown;
  folderId?: unknown;
};

// Shared by the telegram init/chunk routes: a file's owner can always
// upload to it; otherwise the requester needs editor+ on the file's
// folder. Re-run on every chunk (not just at init) so a mid-upload revoke,
// folder move, or ownership transfer takes effect on the very next chunk
// instead of only being checked once at the start of the whole upload.
export async function canUploadToFile(userId: string, file: UploadableFile): Promise<boolean> {
  if (String(file.owner_id) === userId) return true;
  if (!file.folderId) return false;
  const access = await resolveFolderPermission(userId, String(file.folderId));
  return atLeast(access?.role, "editor");
}
