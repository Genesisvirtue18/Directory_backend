import { Business } from '../models/Business.js';
import { User } from '../models/User.js';
import { Category } from '../models/Category.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/response.js';

const slugify = value => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 110) || 'category';
const uniqueSlug = async (name, reserved = new Set()) => { const base = slugify(name); let slug = base; let suffix = 2; while (reserved.has(slug) || await Category.exists({ slug })) slug = `${base}-${suffix++}`; reserved.add(slug); return slug; };
const csvRows = text => {
  const rows = []; let row = []; let cell = ''; let quote = false;
  for (let index = 0; index < text.length; index += 1) { const char = text[index];
    if (char === '"') { if (quote && text[index + 1] === '"') { cell += char; index += 1; } else quote = !quote; }
    else if (char === ',' && !quote) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quote) { if (char === '\r' && text[index + 1] === '\n') index += 1; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (!rows.length) throw new AppError('CSV does not contain any entries', 422);
  const headers = rows[0].map(value => value.toLowerCase().replace(/^\uFEFF/, '').trim());
  const nameIndex = headers.findIndex(value => ['name', 'category', 'subcategory', 'service'].includes(value));
  // A one-column list is convenient for admins, so accept both a labelled
  // CSV (name/service header) and a headerless list such as "Hospitals".
  const dataRows = nameIndex >= 0 ? rows.slice(1) : rows;
  const column = nameIndex >= 0 ? nameIndex : 0;
  return dataRows.map((values, index) => ({ name: values[column]?.trim(), row: index + (nameIndex >= 0 ? 2 : 1) })).filter(item => item.name);
};
const createCategories = async (entries, parentCategory = null) => {
  if (entries.length > 1000) throw new AppError('A CSV can contain at most 1,000 rows', 422);
  const reserved = new Set(); const created = []; const skipped = [];
  for (const entry of entries) {
    const existing = await Category.findOne({ name: new RegExp(`^${entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), parentCategory });
    if (existing) { skipped.push(entry.name); continue; }
    created.push(await Category.create({ name: entry.name, slug: await uniqueSlug(entry.name, reserved), parentCategory }));
  }
  return { created, skipped };
};

export const businesses = () => async (req, res, next) => { try {
  const { page, limit, status } = req.validated.query;
  const filter = { deletedAt: null, ...(status ? { listingStatus: status } : {}) };
  const [items, totalItems] = await Promise.all([Business.find(filter).populate('owner', 'name email').populate('category', 'name').sort('-createdAt').skip((page - 1) * limit).limit(limit).lean(), Business.countDocuments(filter)]);
  sendSuccess(res, 'Businesses retrieved successfully', { items, pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit), hasNextPage: page * limit < totalItems, hasPreviousPage: page > 1 } });
} catch (error) { next(error); } };

export const owners = () => async (req, res, next) => { try {
  const items = await User.find({ role: 'business_owner', status: 'active', deletedAt: null }).select('name email phone').sort('name').lean();
  sendSuccess(res, 'Business owners retrieved successfully', { items });
} catch (error) { next(error); } };

export const createBusiness = () => async (req, res, next) => { try {
  const { ownerId, ...business } = req.validated.body;
  if (!await User.exists({ _id: ownerId, role: 'business_owner', status: 'active', deletedAt: null })) throw new AppError('Active business owner not found', 422);
  if (!await Category.exists({ _id: business.category, isActive: true })) throw new AppError('Category not found', 422);
  const base = business.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'business';
  let slug = base; let suffix = 2;
  while (await Business.exists({ slug })) slug = `${base}-${suffix++}`;
  const item = await Business.create({ ...business, slug, owner: ownerId, listingStatus: 'draft', verificationStatus: 'pending' });
  sendSuccess(res, 'Business draft created successfully', { item }, 201);
} catch (error) { next(error); } };

export const reviewBusiness = () => async (req, res, next) => { try {
  const item = await Business.findOne({ _id: req.params.id, deletedAt: null, listingStatus: 'pending_review' });
  if (!item) throw new AppError('Business not found', 404);
  const { decision, rejectionReason } = req.validated.body;
  if (decision === 'approve' && (!item.description || !item.phone || !item.address?.addressLine1)) throw new AppError('This listing needs a description, phone, and address line 1 before approval', 422);
  item.listingStatus = decision === 'approve' ? 'published' : 'rejected'; item.verificationStatus = decision === 'approve' ? 'verified' : 'rejected'; item.rejectionReason = decision === 'reject' ? rejectionReason : undefined;
  await item.save(); await item.populate('category', 'name slug'); sendSuccess(res, `Business ${decision}d successfully`, { item });
} catch (error) { next(error); } };

export const categoryTree = () => async (_req, res, next) => { try { const items = await Category.find({ isActive: true }).sort('displayOrder name').lean(); const map = new Map(items.map(item => [String(item._id), { ...item, children: [] }])); const roots = []; for (const item of map.values()) item.parentCategory && map.has(String(item.parentCategory)) ? map.get(String(item.parentCategory)).children.push(item) : roots.push(item); sendSuccess(res, 'Category tree retrieved successfully', { items: roots }); } catch (error) { next(error); } };
export const createCategory = () => async (req, res, next) => { try { const { name, parentCategory } = req.validated.body; if (parentCategory && !await Category.exists({ _id: parentCategory, isActive: true, parentCategory: null })) throw new AppError('Parent category not found', 422); const { created } = await createCategories([{ name }], parentCategory || null); if (!created.length) throw new AppError('This category already exists at this level', 409); sendSuccess(res, 'Category created successfully', { item: created[0] }, 201); } catch (error) { next(error); } };
export const importCategories = parentFromPath => async (req, res, next) => { try { const parentCategory = parentFromPath ? req.params.id : null; if (parentCategory && !await Category.exists({ _id: parentCategory, isActive: true, parentCategory: null })) throw new AppError('Parent category not found', 422); if (!req.file?.buffer) throw new AppError('Upload a CSV file', 422); const result = await createCategories(csvRows(req.file.buffer.toString('utf8')), parentCategory); sendSuccess(res, 'Categories imported successfully', { created: result.created, createdCount: result.created.length, skipped: result.skipped }); } catch (error) { next(error); } };
export const addServices = () => async (req, res, next) => { try { const item = await Category.findOne({ _id: req.params.id, isActive: true }); if (!item) throw new AppError('Category or subcategory not found', 404); const services = [...new Set(req.validated.body.services.map(value => value.trim()).filter(Boolean))]; item.services = [...new Set([...item.services, ...services])]; await item.save(); sendSuccess(res, 'Services added successfully', { item, addedCount: services.length }); } catch (error) { next(error); } };
export const importServices = () => async (req, res, next) => { try { const item = await Category.findOne({ _id: req.params.id, isActive: true }); if (!item) throw new AppError('Category or subcategory not found', 404); if (!req.file?.buffer) throw new AppError('Upload a CSV file', 422); const services = csvRows(req.file.buffer.toString('utf8')).map(entry => entry.name); item.services = [...new Set([...item.services, ...services])]; await item.save(); sendSuccess(res, 'Services imported successfully', { item, addedCount: services.length }); } catch (error) { next(error); } };
