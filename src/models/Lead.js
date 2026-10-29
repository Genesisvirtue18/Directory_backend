import mongoose from 'mongoose';
import { emailField, phoneField } from './fields.js';

const leadSchema = new mongoose.Schema({
  business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  phone: { ...phoneField, required: true },
  email: emailField,
  service: { type: String, trim: true, maxlength: 150 },
  message: { type: String, required: true, trim: true, minlength: 5, maxlength: 2000 },
  status: { type: String, enum: ['new', 'contacted', 'converted'], default: 'new' },
  notes: [{ type: String, trim: true, maxlength: 1000 }],
}, { timestamps: true });

leadSchema.index({ business: 1, createdAt: -1 });

export const Lead = mongoose.model('Lead', leadSchema);
