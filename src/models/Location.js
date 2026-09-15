import mongoose from 'mongoose';
import { slugField } from './fields.js';

const locationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  slug: slugField,
  type: { type: String, required: true, enum: ['country', 'state', 'city', 'locality'] },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
  state: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
  city: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
  postalCodes: [{ type: String, trim: true, maxlength: 20 }],
  coordinates: { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: { type: [Number], validate: v => !v || (v.length === 2 && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90) } },
  isActive: { type: Boolean, default: true }, isPopular: { type: Boolean, default: false },
}, { timestamps: true });
locationSchema.index({ type: 1, state: 1, city: 1, isActive: 1 });
locationSchema.index({ coordinates: '2dsphere' });
export const Location = mongoose.model('Location', locationSchema);
