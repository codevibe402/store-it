import mongoose, { Schema, Document, Model } from "mongoose";

// Public link grant, anchored at a folder like a FolderPermission but keyed
// by an unguessable token instead of an authenticated principal. Only the
// SHA-256 hash of the token is stored — a DB read (backup, replica lag,
// admin query) can never leak a usable token, mirroring how the app
// already treats access/refresh tokens.
export interface IShareLink extends Document {
  folderId: mongoose.Types.ObjectId;
  tokenHash: string;
  role: "viewer" | "editor";
  passwordHash: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdBy: mongoose.Types.ObjectId;
  maxUses: number | null;
  useCount: number;
  lastAccessedAt: Date | null;
  failedPasswordAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ShareLinkSchema = new Schema<IShareLink>(
  {
    folderId:     { type: Schema.Types.ObjectId, required: true, index: true },
    tokenHash:    { type: String, required: true, unique: true },
    role:         { type: String, enum: ["viewer", "editor"], required: true, default: "viewer" },
    passwordHash: { type: String, default: null },
    expiresAt:    { type: Date, required: true },
    revokedAt:    { type: Date, default: null },
    createdBy:    { type: Schema.Types.ObjectId, required: true },
    maxUses:      { type: Number, default: null },
    useCount:     { type: Number, default: 0 },
    lastAccessedAt: { type: Date, default: null },
    // Brute-force lockout on the password gate — independent of the token
    // itself (the token is already 256 bits of entropy; this protects the
    // much-weaker password against a holder of a valid token guessing it).
    failedPasswordAttempts: { type: Number, default: 0 },
    lockedUntil:            { type: Date, default: null },
  },
  { timestamps: true }
);

// TTL index — Mongo garbage-collects expired links on its own; resolution
// code must NOT rely on this for correctness (a link must still be
// rejected the instant it's past expiresAt, not whenever the background
// reaper gets to it), only for storage hygiene.
ShareLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
ShareLinkSchema.index({ folderId: 1, revokedAt: 1 });

const ShareLink: Model<IShareLink> =
  mongoose.models.ShareLink ||
  mongoose.model<IShareLink>("ShareLink", ShareLinkSchema);

export default ShareLink;
