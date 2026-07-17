import mongoose, { Schema, Document, Model } from "mongoose";

// Generic retry-safety record. A client-supplied key (e.g. "share:<uuid>")
// is reserved atomically via the unique index before the mutating work
// runs; a retried request with the same key gets the first attempt's
// stored response instead of re-executing the side effect. See
// server/lib/idempotency.ts for the wrapper that uses this.
export interface IIdempotencyKey extends Document {
  key: string;
  scope: string;
  status: "in_progress" | "completed";
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
}

const IdempotencyKeySchema = new Schema<IIdempotencyKey>(
  {
    key:            { type: String, required: true },
    scope:          { type: String, required: true },
    status:         { type: String, enum: ["in_progress", "completed"], required: true, default: "in_progress" },
    responseStatus: { type: Number, default: null },
    responseBody:   { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

IdempotencyKeySchema.index({ scope: 1, key: 1 }, { unique: true });
// Reservations expire after 24h whether or not they ever completed — a
// crashed request shouldn't wedge a key forever.
IdempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

const IdempotencyKey: Model<IIdempotencyKey> =
  mongoose.models.IdempotencyKey ||
  mongoose.model<IIdempotencyKey>("IdempotencyKey", IdempotencyKeySchema);

export default IdempotencyKey;
