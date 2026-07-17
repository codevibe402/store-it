import crypto from "crypto";
import bcrypt from "bcryptjs";
import { ClientSession } from "mongoose";
import { ObjectId } from "mongodb";
import connectDB from "@/adapters/database/mongoose";
import Folder from "@/adapters/database/models/Folder";
import File from "@/adapters/database/models/File";
import User from "@/adapters/database/models/User";
import FolderPermission, { FolderRole } from "@/adapters/database/models/FolderPermission";
import ShareLink from "@/adapters/database/models/ShareLink";
import { ServiceError } from "@/server/services/shareService";

export type { FolderRole };

const ROLE_RANK: Record<FolderRole, number> = { viewer: 1, editor: 2, owner: 3 };
export const ROLES: FolderRole[] = ["viewer", "editor", "owner"];

export function atLeast(role: FolderRole | null | undefined, min: FolderRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export type ResolvedAccess = {
  role: FolderRole;
  source: "owner" | "direct" | "inherited";
  via: string; // folderId the winning grant lives on (self for direct/owner)
};

// ── Core resolution ──────────────────────────────────────────────────────
//
// Given a userId and folderId, determine effective permission in exactly
// one round trip (plus the folder lookup): fetch the folder's materialized
// `ancestors` path, then fetch every FolderPermission this principal holds
// across {folder, ...ancestors} with a single $in query, and pick the
// entry closest to the target folder (highest index in the chain). That
// entry's `state` decides the outcome — 'active' grants its role,
// 'revoked' is an explicit deny that wins over any grant further up the
// tree (an ancestor share does not "leak past" a deny placed on a
// descendant). No recursion, no N+1, cost is O(depth) in memory only.
export async function resolveFolderPermission(
  userId: string,
  folderId: string,
  opts?: { session?: ClientSession }
): Promise<ResolvedAccess | null> {
  await connectDB();
  if (!ObjectId.isValid(folderId)) return null;

  const folder = await Folder.findOne(
    { _id: folderId, deleted: { $ne: true } },
    { owner_id: 1, ancestors: 1 }
  )
    .session(opts?.session ?? null)
    .lean();
  if (!folder) return null;

  if (String(folder.owner_id) === String(userId)) {
    return { role: "owner", source: "owner", via: folderId };
  }

  if (!ObjectId.isValid(userId)) return null;

  const chain = [...(folder.ancestors ?? []).map(String), folderId];
  const grants = await FolderPermission.find(
    { principalType: "user", principalId: userId, folderId: { $in: chain } },
    { folderId: 1, role: 1, state: 1 }
  )
    .session(opts?.session ?? null)
    .lean();

  if (grants.length === 0) return null;

  const depthOf = new Map(chain.map((id, i) => [id, i]));
  let winner: (typeof grants)[number] | null = null;
  let winnerDepth = -1;
  for (const g of grants) {
    const d = depthOf.get(String(g.folderId)) ?? -1;
    if (d > winnerDepth) {
      winner = g;
      winnerDepth = d;
    }
  }
  if (!winner || winner.state === "revoked") return null;

  return {
    role: winner.role,
    source: String(winner.folderId) === folderId ? "direct" : "inherited",
    via: String(winner.folderId),
  };
}

// Throws a ServiceError (404 if the folder doesn't exist/is deleted, 403 if
// access is insufficient) instead of returning a nullable value — use this
// at the top of any route/service call that must revalidate access at
// execution time, not just at request start (TOCTOU-safe by construction:
// every caller re-resolves fresh, there is no cached "was allowed" flag
// carried across awaits).
export async function requireFolderRole(
  userId: string,
  folderId: string,
  min: FolderRole,
  opts?: { session?: ClientSession }
): Promise<ResolvedAccess> {
  const access = await resolveFolderPermission(userId, folderId, opts);
  if (!access) throw new ServiceError("Folder not found", 404);
  if (!atLeast(access.role, min)) throw new ServiceError("Forbidden", 403);
  return access;
}

// ── Direct user grants ───────────────────────────────────────────────────

export async function grantUserPermission(
  actorId: string,
  folderId: string,
  role: FolderRole,
  target: { email?: string; userId?: string }
) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);
  if (!ROLES.includes(role)) throw new ServiceError("role must be viewer, editor, or owner", 400);
  if (!target.email && !target.userId) throw new ServiceError("email or userId is required", 400);

  await connectDB();
  await requireFolderRole(actorId, folderId, "owner");

  const principal = target.userId
    ? await User.findById(target.userId).lean()
    : await User.findOne({ email: target.email?.toLowerCase().trim() }).lean();
  if (!principal) throw new ServiceError("User to share with not found", 404);

  const principalId = principal._id.toString();
  if (principalId === actorId) throw new ServiceError("You cannot share a folder with yourself", 400);

  const folder = await Folder.findOne({ _id: folderId, deleted: { $ne: true } }, { owner_id: 1 }).lean();
  if (!folder) throw new ServiceError("Folder not found", 404);
  if (String(folder.owner_id) === principalId) {
    throw new ServiceError("This user already owns the folder", 400);
  }

  // Atomic upsert on the unique (folderId, principal) index: two admins
  // racing to set different roles for the same user both hit this single
  // document; MongoDB serializes the two writes and the later one wins
  // deterministically. There is never a duplicate row, so there is nothing
  // to reconcile ("only one valid state persists" by construction, not by
  // extra locking).
  const perm = await FolderPermission.findOneAndUpdate(
    { folderId, principalType: "user", principalId },
    { $set: { role, state: "active", grantedBy: actorId } },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  return { permission: perm, principal: { id: principalId, email: principal.email, name: (principal as { name?: string }).name } };
}

// Removes the direct grant at this folder (access falls back to whatever
// an ancestor grants, if anything — matches "stop sharing" in Drive).
export async function unshareUserPermission(actorId: string, folderId: string, principalUserId: string) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);
  if (!ObjectId.isValid(principalUserId)) throw new ServiceError("Invalid userId", 400);

  await connectDB();
  await requireFolderRole(actorId, folderId, "owner");

  return FolderPermission.deleteOne({ folderId, principalType: "user", principalId: principalUserId });
}

// Explicit deny at this folder — blocks the principal here even if an
// ancestor still grants them access. Idempotent (revoking twice is a
// no-op the second time).
export async function revokeUserPermission(actorId: string, folderId: string, principalUserId: string) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);
  if (!ObjectId.isValid(principalUserId)) throw new ServiceError("Invalid userId", 400);

  await connectDB();
  await requireFolderRole(actorId, folderId, "owner");

  return FolderPermission.findOneAndUpdate(
    { folderId, principalType: "user", principalId: principalUserId },
    { $set: { state: "revoked", grantedBy: actorId }, $setOnInsert: { role: "viewer" } },
    { upsert: true, new: true }
  );
}

export async function listFolderAccess(actorId: string, folderId: string) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);
  await connectDB();

  const folder = await Folder.findOne({ _id: folderId, deleted: { $ne: true } }).lean();
  if (!folder) throw new ServiceError("Folder not found", 404);
  await requireFolderRole(actorId, folderId, "owner");

  const chain = [...(folder.ancestors ?? []).map(String), folderId];

  const [grants, links] = await Promise.all([
    FolderPermission.find({ folderId: { $in: chain } }).populate("principalId", "name email").sort({ updatedAt: -1 }).lean(),
    ShareLink.find({ folderId: { $in: chain }, revokedAt: null }).sort({ createdAt: -1 }).lean(),
  ]);

  return {
    owner: { id: folder.owner_id, email: folder.owner_email },
    grants: grants.map((g) => ({
      id: g._id.toString(),
      principal: g.principalId,
      role: g.role,
      state: g.state,
      direct: String(g.folderId) === folderId,
      via: String(g.folderId),
    })),
    links: links.map((l) => ({
      id: l._id.toString(),
      role: l.role,
      expiresAt: l.expiresAt,
      hasPassword: !!l.passwordHash,
      maxUses: l.maxUses,
      useCount: l.useCount,
      direct: String(l.folderId) === folderId,
      via: String(l.folderId),
    })),
  };
}

// ── Public share links ───────────────────────────────────────────────────

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function buildShareUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}/share/folder/${token}`;
}

export async function createShareLink(
  actorId: string,
  folderId: string,
  opts: { role?: "viewer" | "editor"; expiresInDays?: number; password?: string; maxUses?: number }
) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);
  await connectDB();
  await requireFolderRole(actorId, folderId, "owner");

  const role: "viewer" | "editor" = opts.role === "editor" ? "editor" : "viewer";
  const days = Math.min(Math.max(Number(opts.expiresInDays) || 7, 1), 30);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const passwordHash = opts.password ? await bcrypt.hash(opts.password, 10) : null;

  const token = generateToken();
  const tokenHash = hashToken(token);

  const link = await ShareLink.create({
    folderId,
    tokenHash,
    role,
    passwordHash,
    expiresAt,
    createdBy: actorId,
    maxUses: opts.maxUses ?? null,
  });

  return {
    linkId: link._id.toString(),
    token, // returned exactly once — only the hash is persisted
    shareUrl: buildShareUrl(token),
    role,
    expiresAt,
    hasPassword: !!passwordHash,
  };
}

export async function updateShareLink(
  actorId: string,
  folderId: string,
  linkId: string,
  updates: { role?: "viewer" | "editor"; expiresInDays?: number; password?: string | null }
) {
  if (!ObjectId.isValid(folderId) || !ObjectId.isValid(linkId)) throw new ServiceError("Invalid id", 400);
  await connectDB();
  await requireFolderRole(actorId, folderId, "owner");

  const set: Record<string, unknown> = {};
  if (updates.role) set.role = updates.role;
  if (updates.expiresInDays) {
    const days = Math.min(Math.max(Number(updates.expiresInDays), 1), 30);
    set.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
  if (updates.password !== undefined) {
    set.passwordHash = updates.password ? await bcrypt.hash(updates.password, 10) : null;
    set.failedPasswordAttempts = 0;
    set.lockedUntil = null;
  }

  const link = await ShareLink.findOneAndUpdate(
    { _id: linkId, folderId, revokedAt: null },
    { $set: set },
    { new: true }
  ).lean();
  if (!link) throw new ServiceError("Share link not found", 404);

  return { linkId: link._id.toString(), role: link.role, expiresAt: link.expiresAt, hasPassword: !!link.passwordHash };
}

// Revokes one link by id, or (when linkId is omitted) every link on this
// exact folder — kept for backward compatibility with the old "revoke all"
// endpoint shape. Revocation is a single-field atomic update and inherently
// idempotent: revoking an already-revoked/nonexistent link is a no-op, not
// an error, so retries are always safe.
export async function revokeShareLink(actorId: string, folderId: string, linkId?: string) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);
  await connectDB();
  await requireFolderRole(actorId, folderId, "owner");

  const filter: Record<string, unknown> = { folderId, revokedAt: null };
  if (linkId) {
    if (!ObjectId.isValid(linkId)) throw new ServiceError("Invalid link id", 400);
    filter._id = linkId;
  }
  return ShareLink.updateMany(filter, { $set: { revokedAt: new Date() } });
}

export type LinkAccess = {
  linkId: string;
  folderId: string; // the folder the link was created on (the share root)
  role: "viewer" | "editor";
  requiresPassword: boolean;
  expiresAt: Date;
};

// Validates a raw token against the stored hash and returns the access it
// grants on its own folder. Generic 404 for "not found, expired, or
// revoked" — these are indistinguishable to the caller by design, so an
// attacker guessing tokens learns nothing about which case they hit.
//
// `sessionVerified` lets a caller who already proved knowledge of the
// password once (via POST /api/shared/:token/access, which mints a
// short-lived signed cookie scoped to this exact token) skip re-sending it
// on every subsequent browse/download call. The cookie is what's being
// trusted here, not the client's say-so — see server/lib/shareSession.ts.
export async function resolveShareLink(
  token: string,
  password?: string,
  opts?: { sessionVerified?: boolean }
): Promise<LinkAccess> {
  await connectDB();
  const tokenHash = hashToken(token);
  const link = await ShareLink.findOne({ tokenHash, revokedAt: null, expiresAt: { $gt: new Date() } });
  if (!link) throw new ServiceError("Share link not found or expired", 404);

  const folder = await Folder.findOne({ _id: link.folderId, deleted: { $ne: true } }, { _id: 1 }).lean();
  if (!folder) throw new ServiceError("Share link not found or expired", 404);

  if (link.passwordHash && !opts?.sessionVerified) {
    if (link.lockedUntil && link.lockedUntil > new Date()) {
      throw new ServiceError("Too many incorrect attempts — try again later", 429);
    }
    if (!password) {
      return { linkId: link._id.toString(), folderId: String(link.folderId), role: link.role, requiresPassword: true, expiresAt: link.expiresAt };
    }
    const ok = await bcrypt.compare(password, link.passwordHash);
    if (!ok) {
      const attempts = link.failedPasswordAttempts + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await ShareLink.updateOne({ _id: link._id }, { $set: { failedPasswordAttempts: attempts, lockedUntil } });
      throw new ServiceError("Incorrect password", 401);
    }
    if (link.failedPasswordAttempts > 0) {
      await ShareLink.updateOne({ _id: link._id }, { $set: { failedPasswordAttempts: 0, lockedUntil: null } });
    }
  }

  if (link.maxUses && link.useCount >= link.maxUses) {
    throw new ServiceError("This link has reached its use limit", 403);
  }

  await ShareLink.updateOne({ _id: link._id }, { $inc: { useCount: 1 }, $set: { lastAccessedAt: new Date() } });

  return { linkId: link._id.toString(), folderId: String(link.folderId), role: link.role, requiresPassword: false, expiresAt: link.expiresAt };
}

// Extends a resolved link's access to a specific descendant folder — a
// link shared on "Work" must transparently cover "Work/Reports" without a
// second grant existing anywhere. Verifies the requested folder actually
// sits under the link's root via the ancestors array (one lookup) rather
// than trusting the caller.
export async function resolveShareLinkForFolder(
  token: string,
  targetFolderId: string | null | undefined,
  password?: string,
  opts?: { sessionVerified?: boolean }
): Promise<LinkAccess & { requiresPassword: false }> {
  const base = await resolveShareLink(token, password, opts);
  if (base.requiresPassword) return base as unknown as LinkAccess & { requiresPassword: false };

  if (!targetFolderId || targetFolderId === base.folderId) {
    return { ...base, requiresPassword: false };
  }

  if (!ObjectId.isValid(targetFolderId)) throw new ServiceError("Invalid folder id", 400);
  const target = await Folder.findOne({ _id: targetFolderId, deleted: { $ne: true } }, { ancestors: 1 }).lean();
  if (!target) throw new ServiceError("Folder not found", 404);

  const chain = (target.ancestors ?? []).map(String);
  if (!chain.includes(base.folderId)) {
    throw new ServiceError("This link does not grant access to that folder", 403);
  }

  return { ...base, folderId: targetFolderId, requiresPassword: false };
}

// ── Ownership transfer ───────────────────────────────────────────────────
//
// Unlike sharing (which never copies data onto descendants), ownership is
// denormalized per-folder/per-file (owner_id drives "my files" dashboard
// queries), so a transfer has to touch every descendant — bounded by
// subtree size, same as a move. Runs in a transaction: either the whole
// subtree's ownership flips, or none of it does.
export async function transferFolderOwnership(actorId: string, folderId: string, newOwnerUserId: string) {
  if (!ObjectId.isValid(folderId) || !ObjectId.isValid(newOwnerUserId)) {
    throw new ServiceError("Invalid id", 400);
  }
  await connectDB();

  const mongoose = (await import("mongoose")).default;
  const session = await mongoose.startSession();
  try {
    let result: { folderCount: number; newOwnerId: string } | null = null;
    await session.withTransaction(async () => {
      const folder = await Folder.findOne({ _id: folderId, deleted: { $ne: true } }).session(session);
      if (!folder) throw new ServiceError("Folder not found", 404);
      if (String(folder.owner_id) !== actorId) {
        throw new ServiceError("Only the current owner can transfer ownership", 403);
      }

      const newOwner = await User.findById(newOwnerUserId).session(session).lean();
      if (!newOwner) throw new ServiceError("New owner not found", 404);

      const descendants = await Folder.find({ ancestors: folderId }, { _id: 1 }).session(session).lean();
      const ids = [folderId, ...descendants.map((d) => d._id.toString())];

      await Folder.updateMany(
        { _id: { $in: ids } },
        { $set: { owner_id: String(newOwner._id), owner_email: newOwner.email }, $inc: { opVersion: 1 } },
        { session }
      );
      await File.updateMany(
        { $or: [{ folderId: { $in: ids } }, { folders_id: { $in: ids } }], deleted: { $ne: true } },
        { $set: { owner_id: newOwner._id, owner_email: newOwner.email } },
        { session }
      );

      // The previous owner's implicit "owner" access came from owner_id,
      // never a FolderPermission row, so nothing to revoke there. Give
      // them an explicit editor grant so they don't lose access outright.
      await FolderPermission.findOneAndUpdate(
        { folderId, principalType: "user", principalId: actorId },
        { $set: { role: "editor", state: "active", grantedBy: newOwner._id } },
        { upsert: true, session }
      );

      result = { folderCount: ids.length, newOwnerId: String(newOwner._id) };
    });
    return result!;
  } finally {
    await session.endSession();
  }
}
