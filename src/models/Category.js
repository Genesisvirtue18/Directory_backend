import mongoose from 'mongoose';
import { slugField, urlField } from './fields.js';

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  slug: slugField,
  description: { type: String, trim: true, maxlength: 2000 },
  parentCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  icon: { type: String, trim: true, maxlength: 300 },
  image: urlField,
  keywords: [{ type: String, trim: true, maxlength: 80 }],
  // Services live on a subcategory so the owner form can offer the correct
  // choices after a category and subcategory have been selected.
  services: [{ type: String, trim: true, maxlength: 150 }],
  businessCount: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true },
  displayOrder: { type: Number, default: 0, min: 0, validate: Number.isInteger },
}, { timestamps: true });
categorySchema.index({ parentCategory: 1 });
categorySchema.index({ name: 'text', keywords: 'text', description: 'text' });

export const Category = mongoose.model('Category', categorySchema);
