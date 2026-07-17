import mongoose from "mongoose";
const Schema = mongoose.Schema;

const FileSchema = new Schema({
   destination:{ type: String },
   uploadId: { type: String },
   filename:   { type: String, required: true },
   hash:     {type:String,required:true},
   owner_email: { type: String, required: true },
   mimetype:   { type: String },
   size:       { type: Number },
   searchText: { type: String, default: "" },
   textIndexedAt: { type: Date, default: null },
   folders_id: { type: Schema.Types.ObjectId, default: null },
   folderId:   { type: Schema.Types.ObjectId, default: null },
   owner_id:   { type: Schema.Types.ObjectId, required: true },
   storageUrl: { type: String, required: true },
   status: {
     type: String,
     enum: ['pending', 'uploading', 'paused', 'fallback_cleanup', 's3_pending', 'uploaded', 'cancelled', 'failed'],
     default: 'pending',
   },
   backend:    { type: String, enum: ['s3', 'telegram'], default: 's3' },
   totalChunks: { type: Number },
   chunkSize:   { type: Number },
   lastError: { type: String, default: null },
   fallbackFrom: { type: String, enum: ['telegram', null], default: null },
   fallbackReason: { type: String, default: null },
   fallbackStartedAt: { type: Date, default: null },
   fallbackCompletedAt: { type: Date, default: null },
   cleanupWarnings: [{ type: String }],
   currentVersionId: { type: Schema.Types.ObjectId, default: null },
   encryptionIv: { type: String, default: null },
   encryptionKey: { type: String, default: null },
   // 'dek': encrypted client-side with the account's zero-knowledge DEK —
   //        server never has the key, client must decrypt on download.
   // 'server': encrypted with a server-held per-file key (encryptionKey) —
   //           server decrypts transparently, backward-compat mode.
   // 'none': stored as plaintext.
   encryptionMode: { type: String, enum: ['dek', 'server', 'none'], default: 'none' },
   deleted: { type: Boolean, default: false, index: true },
   deletedAt: { type: Date, default: null },
}, { timestamps: true });

FileSchema.index({ owner_id: 1, hash: 1, status: 1 });
FileSchema.index({ owner_id: 1, filename: 1, folderId: 1 });
FileSchema.index({ filename: "text", searchText: "text" });
FileSchema.index({ owner_email: 1, status: 1, createdAt: -1 });
FileSchema.index({ owner_id: 1, status: 1, createdAt: -1 });
FileSchema.index({ owner_id: 1, folderId: 1, status: 1 });

export default mongoose.models.File|| mongoose.model('File', FileSchema);
