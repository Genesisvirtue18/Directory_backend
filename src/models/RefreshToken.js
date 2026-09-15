import mongoose from 'mongoose';
const refreshTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date, default: null }, userAgent: { type: String, maxlength: 500 }, ip: { type: String, maxlength: 100 },
}, { timestamps: true });
export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
