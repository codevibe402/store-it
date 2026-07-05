import mongoose, { Schema, Document } from "mongoose";

export interface IFolderShare extends Document {
  token: string;
  tokenHash: string;
  folderId: string;
  folderName: string;
  owner_id: string;
  permission: "read" | "add";
  expiresAt: Date;
  revokedAt?: Date;
  maxDownloads?: number;
  downloadCount: number;
  allowVersionHistory: boolean;
  createdAt: Date;
}

const FolderShareSchema = new Schema<IFolderShare>(
  {
    token:      { type: String, required: true, unique: true },
    tokenHash:  { type: String, required: true, unique: true },
    folderId:   { type: String, required: true, index: true },
    folderName: { type: String, required: true },
    owner_id:   { type: String, required: true, index: true },
    permission: { type: String, enum: ["read", "add"], default: "read" },
    expiresAt:  { type: Date, required: true },
    revokedAt:  { type: Date, default: null },
    maxDownloads: { type: Number, default: null },
    downloadCount: { type: Number, default: 0 },
    allowVersionHistory: { type: Boolean, default: false },
  },
  { timestamps: true }
);

FolderShareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
FolderShareSchema.index({ tokenHash: 1 });

export default mongoose.models.FolderShare ||
  mongoose.model<IFolderShare>("FolderShare", FolderShareSchema);
