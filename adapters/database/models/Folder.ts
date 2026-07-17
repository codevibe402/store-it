import mongoose, { Schema, Document } from "mongoose";

export interface IFolder extends Document {
  name: string;
  owner_id: string;
  owner_email: string;
  parent_id?: string | null; // for nested folders
  // Materialized path: root -> ... -> immediate parent, NOT including self.
  // This is the backbone of the permission-inheritance model — permission
  // resolution reads this array instead of walking parent_id recursively,
  // and it is the only thing a folder move has to rewrite (never the
  // permission grants themselves). See permissionService.ts.
  ancestors: mongoose.Types.ObjectId[];
  depth: number;
  // Optimistic-concurrency token, hand-rolled (not mongoose's __v) so a
  // move's compare-and-swap filter can target it explicitly. Incremented on
  // every parent_id/ancestors change.
  opVersion: number;
  createdBy?: string | null;
  deleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}

const FolderSchema = new Schema<IFolder>(
  {
    name:        { type: String, required: true },
    owner_id:    { type: String, required: true },
    owner_email: { type: String, required: true },
    parent_id:   { type: String, default: null },
    ancestors:   { type: [Schema.Types.ObjectId], default: [] },
    depth:       { type: Number, default: 0 },
    opVersion:   { type: Number, default: 0 },
    createdBy:   { type: String, default: null },
    deleted:     { type: Boolean, default: false },
    deletedAt:   { type: Date, default: null },
  },
  { timestamps: true }
);

FolderSchema.index({ owner_email: 1, createdAt: -1 });
FolderSchema.index({ owner_id: 1, parent_id: 1 });
FolderSchema.index({ owner_id: 1, deleted: 1 });
// Multikey index — powers "find every descendant of folder X" (used by
// moveFolder's subtree rewrite and cascade delete) in a single query
// instead of a level-by-level walk.
FolderSchema.index({ ancestors: 1 });

export default mongoose.models.Folder ||
  mongoose.model<IFolder>("Folder", FolderSchema);
