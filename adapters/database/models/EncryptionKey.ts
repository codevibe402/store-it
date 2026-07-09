import mongoose, { Schema, Document, Model } from "mongoose";

export interface IEncryptionKey extends Document {
  fileId: mongoose.Types.ObjectId;
  keyBase64: string;
  algorithm: "aes-256-gcm";
  createdAt: Date;
  expiresAt?: Date;
}

const EncryptionKeySchema: Schema<IEncryptionKey> = new Schema(
  {
    fileId: {
      type: Schema.Types.ObjectId,
      ref: "File",
      required: true,
      unique: true,
    },
    keyBase64: {
      type: String,
      required: true,
    },
    algorithm: {
      type: String,
      enum: ["aes-256-gcm"],
      default: "aes-256-gcm",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: false }
);

EncryptionKeySchema.index({ createdAt: 1 });

const EncryptionKey: Model<IEncryptionKey> =
  mongoose.models.EncryptionKey ||
  mongoose.model<IEncryptionKey>("EncryptionKey", EncryptionKeySchema);

export default EncryptionKey;