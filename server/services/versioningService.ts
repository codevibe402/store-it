import { ObjectId } from "mongodb";
import mongoose, { ClientSession } from "mongoose";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";
import User from "@/adapters/database/models/User";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import { ServiceError } from "@/server/services/shareService";

// Centralizes "does a same-name file already exist, and if so fold this
// upload into it as a new version" — previously duplicated independently
// (with drift) across the S3 small-file and S3 multipart upload-completion
// routes, and entirely missing from the Telegram completion route. Every
// write here happens inside the caller's `session.withTransaction(...)`
// (same pattern as folderService.moveFolder) so two concurrent completions
// of the same logical file can't both compute the same "next version"
// number — the transaction's own conflict detection plus the
// FileVersion(file_id, version) unique index make that impossible, and
// withTransaction's automatic retry means the caller doesn't need to
// handle that itself.

export type Backend = "s3" | "telegram";

export interface VersionContent {
  backend: Backend;
  storageUrl: string;
  hash: string;
  size: number;
  mimetype: string;
}

export interface FindConflictParams {
  session: ClientSession;
  filename: string;
  ownerId: mongoose.Types.ObjectId | string;
  folderId: mongoose.Types.ObjectId | string | null;
  hash: string;
  // The placeholder File doc this upload is completing (multipart/Telegram
  // paths) — excluded so it never "conflicts with itself".
  excludeFileId?: mongoose.Types.ObjectId | string;
}

// The existing-same-name-different-content lookup, identical to what both
// S3 routes already did inline.
export async function findConflictingUploadedFile(params: FindConflictParams) {
  const { session, filename, ownerId, folderId, hash, excludeFileId } = params;
  return File.findOne({
    filename,
    owner_id: ownerId,
    folderId,
    status: "uploaded",
    hash: { $ne: hash },
    deleted: { $ne: true },
    ...(excludeFileId ? { _id: { $ne: excludeFileId } } : {}),
  }).session(session);
}

// Server-side ('server' mode, backward-compat) Telegram encryption holds
// exactly one key per File (EncryptionKey.fileId is uniquely indexed,
// shared by every version — confirmed by every read site: shareService,
// sharedFolderService, fileService, downloadService, download.ts). If the
// file being merged into already has one AND the new content also needs
// one, they're necessarily two different keys with no slot to hold both —
// merging would either silently orphan the old version's key (making it
// undecryptable) or the new one. Never do that; the caller falls back to
// today's pre-versioning behavior (a separate File) in this case.
export function wouldConflictServerEncryptionKey(
  existingFile: { encryptionKey?: string | null },
  newEncryptionKey?: string | null
): boolean {
  return Boolean(newEncryptionKey && existingFile.encryptionKey);
}

export interface MergeParams {
  session: ClientSession;
  existingFile: InstanceType<typeof File>;
  content: VersionContent;
  createdBy: mongoose.Types.ObjectId | string;
  // Fields beyond the core content ones to stamp onto the winning File doc
  // — searchText/textIndexedAt (S3 paths), or encryptionMode/encryptionKey/
  // encryptionIv (Telegram, propagated from the placeholder that was just
  // finished uploading). Left undefined fields are not touched.
  extraFileFields?: Record<string, unknown>;
  // The placeholder File doc this content was uploaded under (multipart/
  // Telegram) — deleted once its content is absorbed into existingFile.
  // Undefined for the small-file S3 path, which has no placeholder.
  placeholderFileId?: mongoose.Types.ObjectId | string;
}

export interface VersionResult {
  file: InstanceType<typeof File>;
  version: number;
  versionId: string;
  versioned: boolean;
}

export async function mergeAsNewVersion(params: MergeParams): Promise<VersionResult> {
  const { session, existingFile, content, createdBy, extraFileFields, placeholderFileId } = params;

  const latestVersion = await FileVersion.findOne({ file_id: existingFile._id })
    .sort({ version: -1 })
    .session(session)
    .lean();
  const nextVersion = (latestVersion?.version ?? 1) + 1;

  const [created] = await FileVersion.create(
    [
      {
        file_id: existingFile._id,
        version: nextVersion,
        backend: content.backend,
        storageUrl: content.storageUrl,
        hash: content.hash,
        size: content.size,
        mimetype: content.mimetype,
        createdBy,
      },
    ],
    { session }
  );

  const oldSize = existingFile.size ?? 0;
  // findByIdAndUpdate, not existingFile.save() — session.withTransaction
  // silently retries its callback on a transient conflict (same as
  // folderService.moveFolder), and Mongoose's dirty-path tracking on a
  // pre-fetched document doesn't survive that: a retry's .save() on a
  // document already (locally) marked "saved" by the aborted first attempt
  // sends no fields and silently no-ops. A query-based update has no such
  // state to desync — every retry issues the same complete, self-contained
  // write regardless of what an earlier aborted attempt did in memory.
  const updatedFile = await File.findByIdAndUpdate(
    existingFile._id,
    {
      $set: {
        hash: content.hash,
        mimetype: content.mimetype,
        size: content.size,
        storageUrl: content.storageUrl,
        backend: content.backend,
        currentVersionId: created._id,
        ...(extraFileFields ?? {}),
      },
    },
    { session, new: true }
  );

  await User.findByIdAndUpdate(
    updatedFile!.owner_id,
    { $inc: { storageused: content.size - oldSize } },
    { session }
  );

  if (placeholderFileId) {
    // TelegramChunk rows for this upload are still tagged with the
    // placeholder's _id — re-point them to the surviving file so a later
    // recycle-bin hard-delete (which looks chunks up by fileId, not
    // versionId) can still find and clean them up instead of orphaning
    // them, both in Mongo and as never-deleted Telegram messages. Also
    // stamps versionId, same as the non-merge path does for a Telegram
    // file's first version — content-serving (download/manifest/chunk-data)
    // reads chunks by versionId, not fileId. Both are harmless no-ops for
    // an S3 merge, which has no matching TelegramChunk rows at all.
    await TelegramChunk.updateMany(
      { fileId: placeholderFileId },
      { $set: { fileId: existingFile._id, versionId: created._id } }
    ).session(session);

    await File.deleteOne({ _id: placeholderFileId }).session(session);
  }

  return { file: updatedFile!, version: nextVersion, versionId: created._id.toString(), versioned: true };
}

export interface CreateInitialParams {
  session: ClientSession;
  file: InstanceType<typeof File>;
  content: VersionContent;
  createdBy: mongoose.Types.ObjectId | string;
  extraFileFields?: Record<string, unknown>;
}

// The "no same-name conflict — this is the file's first version" path,
// previously duplicated three times with minor drift between them.
export async function createInitialVersion(params: CreateInitialParams): Promise<VersionResult> {
  const { session, file, content, createdBy, extraFileFields } = params;

  const [version] = await FileVersion.create(
    [
      {
        file_id: file._id,
        version: 1,
        backend: content.backend,
        storageUrl: content.storageUrl,
        hash: content.hash,
        size: content.size,
        mimetype: content.mimetype,
        createdBy,
      },
    ],
    { session }
  );

  const fields = {
    status: "uploaded",
    hash: content.hash,
    mimetype: content.mimetype,
    size: content.size,
    storageUrl: content.storageUrl,
    backend: content.backend,
    currentVersionId: version._id,
    ...(extraFileFields ?? {}),
  };

  // Two distinct callers, two distinct safe strategies:
  // - The direct S3 upload route (no placeholder step) passes a brand-new
  //   `new File(...)` that's never been persisted — constructed fresh
  //   inside the caller's withTransaction callback on every attempt, so
  //   .save() is safe (each retry gets its own untouched instance, nothing
  //   carried over). It must be saved here at all — findByIdAndUpdate
  //   against an _id nothing in the DB has yet would silently match zero
  //   documents and return null.
  // - Multipart/Telegram completion pass an existing placeholder, fetched
  //   once *before* the transaction started and reused by reference across
  //   retries. For that one, findByIdAndUpdate (not .save()) is required —
  //   see the matching comment in mergeAsNewVersion: a withTransaction
  //   retry desyncs Mongoose's dirty-path tracking on a pre-fetched
  //   document, silently dropping the update on the retried attempt even
  //   though the transaction reports success.
  const updatedFile = file.isNew
    ? await Object.assign(file, fields).save({ session })
    : await File.findByIdAndUpdate(file._id, { $set: fields }, { session, new: true });

  await User.findByIdAndUpdate(
    updatedFile!.owner_id,
    { $inc: { storageused: content.size } },
    { session }
  );

  return { file: updatedFile!, version: 1, versionId: version._id.toString(), versioned: false };
}

// Restoring a previous version never deletes or rewrites history — it's
// exactly a mergeAsNewVersion where the "new content" is just a pointer
// back at an old version's already-existing bytes (no re-upload, no new
// storage object). The old FileVersion row being restored, and every other
// version, is completely untouched; this only ever adds a new row on top
// and repoints currentVersionId. No encryption handling is needed here
// (unlike a real new upload might need — see wouldConflictServerEncryptionKey):
// 'server'-mode keys are already file-level and apply to every version;
// Telegram chunks for the version being restored already carry their own
// correct per-chunk nonce.
export async function restoreVersion(userId: string, fileId: string, versionId: string): Promise<VersionResult> {
  if (!ObjectId.isValid(fileId) || !ObjectId.isValid(versionId)) {
    throw new ServiceError("Invalid file or version id", 400);
  }
  await connectDB();

  const session = await mongoose.startSession();
  try {
    let result: VersionResult | undefined;

    await session.withTransaction(async () => {
      const file = await File.findOne({ _id: fileId, owner_id: userId, status: "uploaded", deleted: { $ne: true } }).session(session);
      if (!file) throw new ServiceError("File not found", 404);

      const version = await FileVersion.findOne({ _id: versionId, file_id: fileId, status: "uploaded" }).session(session);
      if (!version) throw new ServiceError("Version not found", 404);

      if (file.currentVersionId?.toString() === version._id.toString()) {
        throw new ServiceError("This is already the current version", 400);
      }

      result = await mergeAsNewVersion({
        session,
        existingFile: file,
        content: {
          backend: version.backend,
          storageUrl: version.storageUrl,
          hash: version.hash,
          size: version.size,
          mimetype: version.mimetype,
        },
        createdBy: userId,
      });
    });

    return result!;
  } finally {
    await session.endSession();
  }
}
