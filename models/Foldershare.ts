import mongoose, { Schema, Document } from "mongoose";

interface IShareFile {
  fileId: string;
  filename: string;
  mimetype: string;
  size: number;
  url: string;
  downloadUrl: string;
}

export interface IFolderShare extends Document {
  token: string;
  folderId: string;       // ← was missing; route.ts stores & queries this
  folderName: string;
  owner_id: string;
  permission: "read" | "add";
  files: IShareFile[];
  expiresAt: Date;
  createdAt: Date;
}

const FolderShareSchema = new Schema<IFolderShare>(
  {
    token:      { type: String, required: true, unique: true },
    folderId:   { type: String, required: true, index: true }, // ← added
    folderName: { type: String, required: true },
    owner_id:   { type: String, required: true, index: true },
    permission: { type: String, enum: ["read", "add"], default: "read" },
    files: [
      {
        fileId:      String,
        filename:    String,
        mimetype:    String,
        size:        Number,
        url:         String,
        downloadUrl: String,
      },
    ],
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL index — MongoDB auto-deletes documents after expiresAt.
// Defined once here on the schema, not on every POST request.
FolderShareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.FolderShare ||
  mongoose.model<IFolderShare>("FolderShare", FolderShareSchema);
