import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IFileVersion extends Document {
  file_id: mongoose.Types.ObjectId;
  version: number;
  backend: 's3' | 'telegram';
  storageUrl: string;
  hash: string;
  size: number;
  mimetype: string;
  status: 'uploaded' | 'failed' | 'deleted';
  createdBy: mongoose.Types.ObjectId;
  uploadedAt?: Date;
}

const FileVersionSchema: Schema<IFileVersion> = new Schema(
  {
    file_id: {
      type: Schema.Types.ObjectId,
      ref: 'File',
      required: [true, 'File reference is required'],
    },
    version: {
      type: Number,
      required: [true, 'Version number is required'],
      min: 1,
    },
    backend: {
      type: String,
      enum: ['s3', 'telegram'],
      required: true,
    },
    storageUrl: {
      type: String,
      required: [true, 'Storage URL is required'],
    },
    hash: { type: String, required: true },
    size: { type: Number, required: true },
    mimetype: { type: String, default: 'application/octet-stream' },
    status: {
      type: String,
      enum: ['uploaded', 'failed', 'deleted'],
      default: 'uploaded',
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

FileVersionSchema.index({ file_id: 1, version: -1 });
FileVersionSchema.index(
  { file_id: 1, version: 1 },
  { unique: true }
);

const FileVersion: Model<IFileVersion> =
  mongoose.models.FileVersion ||
  mongoose.model<IFileVersion>('FileVersion', FileVersionSchema);

export default FileVersion;