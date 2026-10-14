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

const reviewSchema = new Schema({
  reviewerName: { type: String, required: true, trim: true, maxlength: 120 },
  reviewerAvatar: urlField,
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, trim: true, maxlength: 3000 },
  isVerified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const testimonialSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  quote: { type: String, required: true, trim: true, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const socialLinksSchema = new Schema({
  facebook: urlField,
  instagram: urlField,
  linkedin: urlField,
  youtube: urlField,
  x: urlField,
}, { _id: false });

const faqSchema = new Schema({
  question: { type: String, required: true, trim: true, maxlength: 500 },
  answer: { type: String, required: true, trim: true, maxlength: 3000 },
}, { _id: true });

const offerSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  description: { type: String, trim: true, maxlength: 2000 },
  code: { type: String, trim: true, uppercase: true, maxlength: 50 },
  validFrom: Date,
  validUntil: Date,
  isActive: { type: Boolean, default: true },
}, { _id: true });
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
  photoCount: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  priceRange: { type: String, enum: ['budget', 'moderate', 'expensive', 'luxury'] },
  keywords: [{ type: String, trim: true, maxlength: 80 }],
  highlights: [{ type: String, trim: true, maxlength: 180 }],
  amenities: [{ type: String, trim: true, maxlength: 180 }],
  establishedYear: { type: Number, min: 1800, max: new Date().getFullYear(), validate: Number.isInteger },
  teamSize: { type: Number, min: 1, validate: Number.isInteger },
  responseTimeMinutes: { type: Number, min: 0, validate: Number.isInteger },
  mapEmbedUrl: urlField,
  socialLinks: socialLinksSchema,
  faqs: [faqSchema],
  offers: [offerSchema],
  reviews: [reviewSchema],
  testimonials: { type: [testimonialSchema], default: [] },
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
businessSchema.index({ category: 1, listingStatus: 1, deletedAt: 1, averageRating: -1 }, { collation: { locale: 'en', strength: 2 } });
businessSchema.index({ 'address.city': 1, 'address.locality': 1 });
businessSchema.index({ 'address.locality': 1 });
businessSchema.index({ listingStatus: 1 });
businessSchema.index({ listingStatus: 1, deletedAt: 1, createdAt: -1 }, { collation: { locale: 'en', strength: 2 } });
businessSchema.index({ listingStatus: 1, deletedAt: 1, isFeatured: -1, averageRating: -1, _id: 1 }, { collation: { locale: 'en', strength: 2 } });
businessSchema.index({ listingStatus: 1, deletedAt: 1, averageRating: -1, reviewCount: -1, _id: 1 }, { collation: { locale: 'en', strength: 2 } });
businessSchema.index({ listingStatus: 1, deletedAt: 1, 'address.city': 1, 'address.locality': 1, verificationStatus: 1, averageRating: -1 });
businessSchema.index({ listingStatus: 1, deletedAt: 1, 'address.city': 1, 'address.locality': 1, 'address.state': 1, verificationStatus: 1, averageRating: -1 }, { collation: { locale: 'en', strength: 2 } });
businessSchema.index({ owner: 1, deletedAt: 1 });
businessSchema.index({ name: 'text', description: 'text', keywords: 'text', services: 'text' });
businessSchema.pre('validate', function standardizeEmbeddedData() {
  if (this.isModified('reviews')) {
    const ratings = this.reviews.map(review => Number(review.rating)).filter(rating => Number.isFinite(rating) && rating >= 1 && rating <= 5);
    this.reviewCount = ratings.length;
    this.averageRating = ratings.length ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2)) : 0;
  }
  if (this.isModified('images')) this.photoCount = this.images.length;
});

export const Business = mongoose.model('Business', businessSchema);
