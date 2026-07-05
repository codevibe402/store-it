// models/FileShare.ts
import mongoose, { Schema, Document } from "mongoose";

export interface IFileShare extends Document {
  fileId:    string;
  filename:  string;
  owner_id:  string;
  shareUrl:  string;
  expiresAt: Date;
  createdAt: Date;
}

const FileShareSchema = new Schema<IFileShare>(
  {
    fileId:   { type: String, required: true, index: true },
    filename: { type: String, required: true },
    owner_id: { type: String, required: true, index: true },
    shareUrl: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL index — MongoDB auto-deletes expired share records.
// Defined once here on the schema, not inside the POST handler.
FileShareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.FileShare ||
  mongoose.model<IFileShare>("FileShare", FileShareSchema);