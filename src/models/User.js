import mongoose from 'mongoose';
import { emailField, phoneField, urlField } from './fields.js';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  email: { ...emailField, required() { return !this.phone; } },
  phone: { ...phoneField, required() { return !this.email; } },
  // Authentication must generate a hash; this model never hashes or accepts a raw password.
  passwordHash: { type: String, select: false, validate: {
    validator: value => value == null || /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value)
      || /^\$argon2(?:id|i|d)\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(value),
    message: 'passwordHash must be a bcrypt or Argon2 encoded hash',
  } },
  avatar: urlField,
  role: { type: String, enum: ['customer', 'business_owner', 'admin', 'super_admin'], default: 'customer' },
  emailVerified: { type: Boolean, default: false },
  phoneVerified: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
  passwordChangedAt: Date,
  deletedAt: { type: Date, default: null },
  notificationPreferences: { email: { type: Boolean, default: true }, sms: { type: Boolean, default: false } },
  lastLoginAt: Date,
}, {
  timestamps: true,
  toJSON: { transform(doc, ret) { delete ret.passwordHash; return ret; } },
  toObject: { transform(doc, ret) { delete ret.passwordHash; return ret; } },
});
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });

export const User = mongoose.model('User', userSchema);
