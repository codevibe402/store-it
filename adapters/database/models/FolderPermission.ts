import mongoose, { Schema, Document, Model } from "mongoose";

// A direct grant anchored at a specific folder for a specific principal.
// Never copied onto descendants — inheritance is computed at read time by
// walking the target folder's `ancestors` array (see permissionService.ts).
//
// `state: 'revoked'` is a first-class value, not a deletion. It lets an
// owner explicitly block a principal at one node even though a grant
// exists further up the tree (an "inherited deny"), and it lets the
// unique index below prevent the classic "two concurrent shares create two
// rows" race — there is always at most one row per (folder, principal),
// and re-sharing after a revoke flips the same row back to 'active'.
export type FolderRole = "viewer" | "editor" | "owner";
export type PrincipalType = "user"; // extend later: "group" | "org"

export interface IFolderPermission extends Document {
  folderId: mongoose.Types.ObjectId;
  principalType: PrincipalType;
  principalId: mongoose.Types.ObjectId;
  role: FolderRole;
  state: "active" | "revoked";
  grantedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FolderPermissionSchema = new Schema<IFolderPermission>(
  {
    folderId:      { type: Schema.Types.ObjectId, required: true, index: true },
    principalType: { type: String, enum: ["user"], required: true, default: "user" },
    principalId:   { type: Schema.Types.ObjectId, required: true, ref: "User" },
    role:          { type: String, enum: ["viewer", "editor", "owner"], required: true },
    state:         { type: String, enum: ["active", "revoked"], required: true, default: "active" },
    grantedBy:     { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true }
);

// One row per (folder, principal) — grants are upserted, never inserted
// blindly, so concurrent "share with the same user" calls collapse onto
// the same document instead of producing duplicate/conflicting rows.
FolderPermissionSchema.index(
  { folderId: 1, principalType: 1, principalId: 1 },
  { unique: true }
);

// Powers permission resolution: given a principal and a chain of folder
// ids (self + ancestors), fetch every grant for that principal across the
// whole chain in one indexed query.
FolderPermissionSchema.index({ principalType: 1, principalId: 1, folderId: 1 });

const FolderPermission: Model<IFolderPermission> =
  mongoose.models.FolderPermission ||
  mongoose.model<IFolderPermission>("FolderPermission", FolderPermissionSchema);

export default FolderPermission;
