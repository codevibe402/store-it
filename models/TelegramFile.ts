import mongoose from "mongoose";

const TelegramFileSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  hash: { type: String, required: true },
  size: { type: Number, required: true },
  mimetype: { type: String },
  owner_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  owner_email: { type: String, required: true },
  folderId: { type: mongoose.Schema.Types.ObjectId, default: null },
  totalChunks: { type: Number, required: true },
  chunkSize: { type: Number, required: true },
  status: { type: String, enum: ["pending", "uploaded"], default: "pending" },
}, { timestamps: true });

TelegramFileSchema.index({ owner_id: 1, hash: 1 }, { unique: true, partialFilterExpression: { status: "uploaded" } });

export default mongoose.models.TelegramFile || mongoose.model("TelegramFile", TelegramFileSchema);
