import mongoose from "mongoose";
const Schema = mongoose.Schema;

// models/File.ts
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
  status:     { type: String, enum: ['pending', 'uploaded'], default: 'pending' },
  backend:    { type: String, enum: ['s3', 'telegram'], default: 's3' },
  totalChunks: { type: Number },
  chunkSize:   { type: Number },
}, { timestamps: true });

FileSchema.index({ owner_id: 1, hash: 1, status: 1 });
FileSchema.index({ filename: "text", searchText: "text" });

export default mongoose.models.File|| mongoose.model('File', FileSchema);
