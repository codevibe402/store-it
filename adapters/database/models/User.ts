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
