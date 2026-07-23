// models/User.ts
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

function isPasswordRequired(this: { provider?: string }): boolean {
  return this.provider === 'credentials';
}

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:  { type: String, required: true, trim: true },
  password: {
    type: String,
    required: isPasswordRequired,
    select: false,
  },
  provider:     { type: String, default: 'credentials' },  
  providerId:   { type: String },  
  storageused:  { type: Number, default: 0 },
  storagelimit: { type: Number, default: 5 * 1024 * 1024 * 1024 },
  createdAt: { type: Date, default: Date.now },
  // Zero-knowledge file encryption: the account's Data Encryption Key (DEK)
  // is generated client-side and never sent to the server in the clear. The
  // server only ever stores it wrapped (encrypted) by a key derived from a
  // recovery code that's shown to the user once. This lets a new device
  // recover file access without the server ever being able to decrypt files.
  encryptionRecoveryWrapped: { type: String, default: null },
  encryptionRecoveryNonce:   { type: String, default: null },
  encryptionRecoverySalt:    { type: String, default: null },
  encryptionSetupAt:         { type: Date, default: null },
  // Bcrypt hash of the recovery code, set once at encryption setup — lets
  // the server verify a recovery-code login (server/auth/recovery.ts)
  // without ever storing the code itself, same trust model as `password`.
  encryptionRecoveryCodeHash: { type: String, select: false, default: null },
});


UserSchema.pre("save", async function () {
  if (!this.password || !this.isModified("password")) return
  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
})

UserSchema.virtual('storagePercent').get(function () {
  return ((this.storageused / this.storagelimit) * 100).toFixed(2);
});

UserSchema.methods.hasEnoughStorage = function (fileSize: number) {
  return this.storageused + fileSize <= this.storagelimit;
};

export default mongoose.models.User || mongoose.model('User', UserSchema);
