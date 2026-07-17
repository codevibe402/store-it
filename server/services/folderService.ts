import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import JSZip from "jszip";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import connectDB from "@/adapters/database/mongoose";
import { BUCKET, s3 } from "@/adapters/storage/s3";
import File from "@/adapters/database/models/File";
import Folder from "@/adapters/database/models/Folder";
import { ServiceError } from "./shareService";
import { requireFolderRole, resolveFolderPermission } from "./permissionService";

// Folders created before the ancestors/depth fields existed have neither
// on their stored document (Mongoose schema defaults only apply to newly
// created documents, never retroactively to rows already in the DB —
// .lean() reads skip document hydration entirely, so a missing field
// comes back as undefined, not []). Every read site normalizes through
// this so an unmigrated legacy folder degrades to "treated as a root"
// instead of throwing when spread/mapped.
function normalizedAncestors(folder: { ancestors?: mongoose.Types.ObjectId[] | null }): mongoose.Types.ObjectId[] {
  return folder.ancestors ?? [];
}

export async function createFolder(userId: string, userEmail: string, name: string, parentId?: string | null) {
  if (!name?.trim()) throw new ServiceError("Folder name required", 400);
  await connectDB();

  if (!parentId) {
    return Folder.create({
      name: name.trim(),
      owner_id: userId,
      owner_email: userEmail,
      parent_id: null,
      ancestors: [],
      depth: 0,
      createdBy: userId,
    });
  }

  if (!ObjectId.isValid(parentId)) throw new ServiceError("Invalid parentId", 400);

  const parent = await Folder.findOne({ _id: parentId, deleted: { $ne: true } }).lean();
  if (!parent) throw new ServiceError("Parent folder not found", 404);

  // Editor+ can create subfolders — including inside a folder shared with
  // them, not just folders they own. New folder inherits ownership from
  // the parent (mirrors the existing uploadToSharedFolder pattern: content
  // created inside a shared tree belongs to the tree's owner, editors
  // don't fork off their own ownership island), and its `ancestors` is the
  // parent's own chain plus the parent itself — the only two writes
  // needed for inheritance to apply automatically to it and everything
  // created under it later.
  await requireFolderRole(userId, parentId, "editor");

  return Folder.create({
    name: name.trim(),
    owner_id: String(parent.owner_id),
    owner_email: parent.owner_email,
    parent_id: parentId,
    ancestors: [...normalizedAncestors(parent), parent._id],
    depth: (parent.depth ?? 0) + 1,
    createdBy: userId,
  });
}

export async function getFolders(userEmail: string) {
  await connectDB();

  return Folder.find({ owner_email: userEmail, deleted: { $ne: true } })
    .select("name owner_id parent_id ancestors depth createdAt _id")
    .sort({ createdAt: -1 })
    .lean();
}

// Folders directly or transitively shared with this user — i.e. every
// folder where the user holds an active FolderPermission (their own
// grant, not inherited-only rows), for a "Shared with me" view.
export async function getFoldersSharedWithMe(userId: string) {
  await connectDB();
  const FolderPermission = (await import("@/adapters/database/models/FolderPermission")).default;

  const grants = await FolderPermission.find({ principalType: "user", principalId: userId, state: "active" })
    .select("folderId role")
    .lean();
  if (grants.length === 0) return [];

  const roleByFolderId = new Map(grants.map((g) => [String(g.folderId), g.role]));
  const folders = await Folder.find({ _id: { $in: [...roleByFolderId.keys()] }, deleted: { $ne: true } })
    .select("name owner_id owner_email parent_id ancestors depth createdAt _id")
    .lean();

  return folders.map((f) => ({ ...f, role: roleByFolderId.get(String(f._id)) }));
}

// Transactional, optimistic-concurrency-checked move. Only the moved
// subtree's `ancestors` arrays change (bounded by subtree size) — no
// permission document is ever read, copied, or rewritten by a move, which
// is exactly what keeps inherited permissions correct for free: a grant
// living on an ancestor automatically stops (or starts) applying the
// instant the pointer changes, in the same transaction as the move.
export async function moveFolder(userId: string, folderId: string, parentId: string | null) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);
  if (parentId !== null && !ObjectId.isValid(parentId)) throw new ServiceError("Invalid parentId", 400);
  if (parentId === folderId) throw new ServiceError("A folder cannot be moved into itself", 400);

  await connectDB();
  const session = await mongoose.startSession();
  try {
    let updated: unknown = null;

    // withTransaction auto-retries the callback on MongoDB transient
    // transaction errors (e.g. a write-conflict from another concurrent
    // move touching an overlapping descendant), so a genuinely concurrent
    // move either fully re-runs against fresh state or the loser gets our
    // explicit 409 below — there is no partial/interleaved outcome.
    await session.withTransaction(async () => {
      const folder = await Folder.findOne({ _id: folderId, deleted: { $ne: true } }).session(session);
      if (!folder) throw new ServiceError("Folder not found", 404);
      await requireFolderRole(userId, folderId, "editor", { session });

      let newAncestors: mongoose.Types.ObjectId[] = [];
      if (parentId !== null) {
        const target = await Folder.findOne({ _id: parentId, deleted: { $ne: true } }).session(session);
        if (!target) throw new ServiceError("Target folder not found", 404);
        await requireFolderRole(userId, parentId, "editor", { session });

        const targetAncestors = normalizedAncestors(target);
        const targetIsSelfOrDescendant =
          String(target._id) === folderId || targetAncestors.some((a) => String(a) === folderId);
        if (targetIsSelfOrDescendant) {
          throw new ServiceError("Cannot move a folder into its own descendant", 400);
        }
        newAncestors = [...targetAncestors, target._id];
      }

      const oldPrefixLen = normalizedAncestors(folder).length + 1; // folder's own old ancestors + itself
      const descendants = await Folder.find({ ancestors: folder._id }, { ancestors: 1 }).session(session).lean();

      const folderCas = await Folder.updateOne(
        { _id: folder._id, opVersion: folder.opVersion },
        { $set: { parent_id: parentId, ancestors: newAncestors, depth: newAncestors.length }, $inc: { opVersion: 1 } },
        { session }
      );
      if (folderCas.matchedCount === 0) {
        throw new ServiceError("Folder was modified concurrently — please retry", 409);
      }

      if (descendants.length > 0) {
        const bulkOps = descendants.map((d) => {
          const suffix = d.ancestors.slice(oldPrefixLen);
          const newDescAncestors = [...newAncestors, folder._id, ...suffix];
          return {
            updateOne: {
              filter: { _id: d._id },
              update: { $set: { ancestors: newDescAncestors, depth: newDescAncestors.length }, $inc: { opVersion: 1 } },
            },
          };
        });
        await Folder.bulkWrite(bulkOps, { session, ordered: false });
      }

      updated = await Folder.findById(folder._id).session(session).lean();
    });

    return updated;
  } finally {
    await session.endSession();
  }
}

export async function renameFolder(userId: string, folderId: string, name: string) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);
  if (!name?.trim()) throw new ServiceError("Folder name required", 400);
  await connectDB();

  await requireFolderRole(userId, folderId, "editor");

  const folder = await Folder.findOneAndUpdate(
    { _id: folderId, deleted: { $ne: true } },
    { $set: { name: name.trim() }, $inc: { opVersion: 1 } },
    { new: true }
  ).lean();
  if (!folder) throw new ServiceError("Folder not found", 404);
  return folder;
}

// Fast path: hide the folder from the UI immediately. Called synchronously
// from the DELETE route before responding — must stay cheap (single update).
export async function softDeleteFolderFast(userId: string, folderId: string) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);

  await connectDB();
  await requireFolderRole(userId, folderId, "editor");

  const folder = await Folder.findOne({ _id: folderId, deleted: { $ne: true } }).lean();
  if (!folder) throw new ServiceError("Folder not found", 404);

  const deletedAt = new Date();
  await Folder.updateOne({ _id: folderId }, { $set: { deleted: true, deletedAt }, $inc: { opVersion: 1 } });
  return { folderId, deletedAt };
}

// Background path: recursively hides every descendant folder and moves every
// contained file into the recycle bin (soft delete), same as a normal single
// file delete. Runs after the response has already been sent (via `after()`
// in the route), so it must tolerate the folder already being marked deleted.
// Uses `deleted: false` filters rather than the folder's owner_id filter so
// it still works when the actor was an editor on someone else's tree.
export async function cascadeDeleteFolderContents(folderId: string) {
  await connectDB();

  const deletedAt = new Date();
  const subtreeIds = [folderId];
  let frontier = [folderId];

  while (frontier.length > 0) {
    const children = await Folder.find({
      parent_id: { $in: frontier },
      deleted: { $ne: true },
    }).select("_id").lean();

    if (children.length === 0) break;

    const childIds = children.map((c) => c._id.toString());
    await Folder.updateMany(
      { _id: { $in: childIds } },
      { $set: { deleted: true, deletedAt } }
    );

    subtreeIds.push(...childIds);
    frontier = childIds;
  }

  await File.updateMany(
    {
      $or: [{ folderId: { $in: subtreeIds } }, { folders_id: { $in: subtreeIds } }],
      deleted: { $ne: true },
    },
    { $set: { deleted: true, deletedAt } }
  );

  return { folderCount: subtreeIds.length };
}

export async function downloadFolderAsZip(userId: string, folderId: string) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);

  await connectDB();
  await requireFolderRole(userId, folderId, "viewer");

  const folder = await Folder.findOne({ _id: folderId, deleted: { $ne: true } }).lean();
  if (!folder) throw new ServiceError("Folder not found", 404);

  // Files belong to the tree's owner_id (see createFolder/uploadToSharedFolder),
  // not necessarily the requester — a viewer/editor downloads the owner's files.
  const files = await File.find({ folderId, owner_id: folder.owner_id, status: "uploaded" }).lean();
  if (files.length === 0) throw new ServiceError("Folder is empty", 400);

  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  await Promise.all(
    files.map(async (file) => {
      try {
        const s3Res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: file.storageUrl }));
        const chunks: Uint8Array[] = [];
        for await (const chunk of s3Res.Body as AsyncIterable<Uint8Array>) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        const base = file.filename as string;
        const count = usedNames.get(base) ?? 0;
        const name = count === 0 ? base : dedupName(base, count);
        usedNames.set(base, count + 1);

        zip.file(name, buffer);
      } catch (err) {
        console.error(`[ZIP] Failed to fetch S3 key ${file.storageUrl}`, err);
      }
    })
  );

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });

  return { zipBuffer, folderName: folder.name as string };
}

function dedupName(original: string, count: number): string {
  const dot = original.lastIndexOf(".");
  if (dot === -1) return `${original} (${count})`;
  return `${original.slice(0, dot)} (${count})${original.slice(dot)}`;
}

export { resolveFolderPermission };
