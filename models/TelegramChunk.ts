import mongoose from "mongoose";

const TelegramChunkSchema = new mongoose.Schema({
  fileId: { type: mongoose.Schema.Types.ObjectId, ref: "File", required: true },
  versionId: { type: mongoose.Schema.Types.ObjectId, ref: "FileVersion", default: null },
  chunkIndex: { type: Number, required: true },
  hash: { type: String, required: true },
  size: { type: Number, required: true },
  telegramMessageId: { type: Number, required: true },
  telegramFileId: { type: String, required: true },
}, { timestamps: true });

TelegramChunkSchema.index({ fileId: 1, chunkIndex: 1 }, { unique: true });
TelegramChunkSchema.index({ fileId: 1 });
TelegramChunkSchema.index({ versionId: 1, chunkIndex: 1 });

export default mongoose.models.TelegramChunk || mongoose.model("TelegramChunk", TelegramChunkSchema);
