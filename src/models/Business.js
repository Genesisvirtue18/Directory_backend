import mongoose from 'mongoose';
import { emailField, phoneField, slugField, urlField } from './fields.js';

const { Schema } = mongoose;
const addressSchema = new Schema({
  addressLine1: { type: String, trim: true, maxlength: 250 },
  addressLine2: { type: String, trim: true, maxlength: 250 },
  landmark: { type: String, trim: true, maxlength: 150 },
  locality: { type: String, trim: true, maxlength: 120 },
  city: { type: String, trim: true, maxlength: 120 },
  state: { type: String, trim: true, maxlength: 120 },
  postalCode: { type: String, trim: true, maxlength: 20 },
  country: { type: String, trim: true, uppercase: true, match: /^[A-Z]{2}$/ },
}, { _id: false });

const locationSchema = new Schema({
  type: { type: String, enum: ['Point'], default: 'Point', required: true },
  coordinates: { type: [Number], default: undefined, required: true, validate: {
    validator: value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
      && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90,
    message: 'Coordinates must be [longitude, latitude] within valid ranges',
  } },
}, { _id: false });

const hoursSchema = new Schema({
  day: { type: String, required: true, enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
  isClosed: { type: Boolean, default: false },
  opens: { type: String, match: /^(?:[01]\d|2[0-3]):[0-5]\d$/, required() { return !this.isClosed; } },
  closes: { type: String, match: /^(?:[01]\d|2[0-3]):[0-5]\d$/, required() { return !this.isClosed; } },
}, { _id: false });
const counter = { type: Number, default: 0, min: 0, validate: Number.isInteger };

const businessSchema = new Schema({
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, maxlength: 180 },
  slug: slugField,
  description: { type: String, trim: true, maxlength: 10000 },
  category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
  subcategories: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
  services: [{ type: String, trim: true, maxlength: 150 }],
  phone: phoneField,
  alternatePhone: phoneField,
  whatsapp: phoneField,
  email: emailField,
  website: urlField,
  address: addressSchema,
  location: { type: locationSchema, default: undefined },
  workingHours: { type: [hoursSchema], validate: {
    validator: value => new Set(value.map(entry => entry.day)).size === value.length,
    message: 'Each working day must appear only once',
  } },
  logo: urlField,
  images: [urlField],
  priceRange: { type: String, enum: ['budget', 'moderate', 'expensive', 'luxury'] },
  keywords: [{ type: String, trim: true, maxlength: 80 }],
  rejectionReason: { type: String, maxlength: 2000 },
  timeZone: { type: String, default: 'Asia/Kolkata' },
  verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  listingStatus: { type: String, enum: ['draft', 'pending_review', 'published', 'suspended', 'deleted'], default: 'draft' },
  averageRating: { type: Number, default: 0, min: 0, max: 5 },
  reviewCount: counter,
  viewCount: counter,
  isFeatured: { type: Boolean, default: false },
  contactClickCount: counter,
  leadCount: counter,
  featuredUntil: Date,
  subscription: { type: Schema.Types.ObjectId, ref: 'Subscription' },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

businessSchema.index({ location: '2dsphere' });
businessSchema.index({ category: 1 });
businessSchema.index({ 'address.city': 1, 'address.locality': 1 });
businessSchema.index({ 'address.locality': 1 });
businessSchema.index({ listingStatus: 1 });
businessSchema.index({ owner: 1, deletedAt: 1 });
businessSchema.index({ name: 'text', description: 'text', keywords: 'text', services: 'text' });

export const Business = mongoose.model('Business', businessSchema);
