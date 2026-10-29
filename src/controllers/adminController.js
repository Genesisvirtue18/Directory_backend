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
const parseCsvTable = text => {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === ',') { row.push(cell.trim()); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new AppError('CSV contains an unclosed quoted field', 422);
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) throw new AppError('CSV does not contain any entries', 422);
  const headers = rows[0].map(value => value.replace(/^\uFEFF/, '').trim());
  if (headers.some(header => !header)) throw new AppError('CSV headers cannot be empty', 422);
  if (new Set(headers.map(header => header.toLowerCase())).size !== headers.length) throw new AppError('CSV contains duplicate headers', 422);
  return { headers, rows: rows.slice(1) };
};
const csvList = value => value ? value.split('|').map(item => item.trim()).filter(Boolean) : [];
const csvJson = (value, label) => {
  if (!value) return undefined;
  try {
    const result = JSON.parse(value);
    if (!Array.isArray(result)) throw new Error();
    return result;
  } catch {
    throw new Error(`${label} must be a JSON array`);
  }
};
const csvNumber = (value, label) => {
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a number`);
  return number;
};
const exactName = value => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const isGoogleMapsUrl = value => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'google.com' || host.endsWith('.google.com') || host === 'google.co.in' || host.endsWith('.google.co.in');
  } catch { return false; }
};
const businessSlug = async name => {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 110) || 'business';
  let slug = base; let suffix = 2;
  while (await Business.exists({ slug })) slug = `${base}-${suffix++}`;
  return slug;
};
const businessFromCsvRow = async (values, headers) => {
  const row = Object.fromEntries(headers.map((header, index) => [header.toLowerCase(), values[index] || '']));
  if (values.length > headers.length && values.slice(headers.length).some(Boolean)) throw new Error('Row has more values than the header');
  for (const field of ['name', 'owneremail', 'category', 'description', 'services', 'phone', 'email', 'addressline1', 'city', 'state']) {
    if (!row[field]?.trim()) throw new Error(`${field} is required`);
  }
  if (!/^[6-9]\d{9}$/.test(row.phone)) throw new Error('Phone must be a valid 10-digit Indian number');
  for (const field of ['alternatephone', 'whatsapp']) {
    if (row[field] && !/^[6-9]\d{9}$/.test(row[field])) throw new Error(`${field} must be a valid 10-digit Indian number`);
  }
  const owner = await User.findOne({ email: row.owneremail.trim().toLowerCase(), role: 'business_owner', status: 'active', deletedAt: null });
  if (!owner) throw new Error('No active business owner matches ownerEmail');
  const category = await Category.findOne({ name: exactName(row.category.trim()), parentCategory: null, isActive: true });
  if (!category) throw new Error(`Active category "${row.category.trim()}" was not found`);
  let subcategories;
  if (row.subcategory) {
    const subcategory = await Category.findOne({ name: exactName(row.subcategory.trim()), parentCategory: category._id, isActive: true });
    if (!subcategory) throw new Error(`Subcategory "${row.subcategory.trim()}" was not found under "${category.name}"`);
    subcategories = [subcategory._id];
  }
  const services = csvList(row.services);
  if (!services.length) throw new Error('At least one service is required');
  if (services.length > 100) throw new Error('Services can contain at most 100 values');
  if (row.mapembedurl && !isGoogleMapsUrl(row.mapembedurl)) throw new Error('mapEmbedUrl must be a Google Maps link');

  const workingHours = [];
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    const hours = row[`${day}hours`]?.trim();
    if (!hours) continue;
    if (hours.toLowerCase() === 'closed') workingHours.push({ day, isClosed: true });
    else {
      const match = hours.match(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/);
      if (!match) throw new Error(`${day}Hours must be "HH:MM-HH:MM" or "closed"`);
      const [opens, closes] = hours.split('-');
      workingHours.push({ day, opens, closes });
    }
  }
  const socialLinks = Object.fromEntries(['facebook', 'instagram', 'linkedin', 'youtube', 'x'].filter(key => row[key]).map(key => [key, row[key]]));
  const business = {
    name: row.name.trim(),
    description: row.description.trim(),
    category: category._id,
    ...(subcategories ? { subcategories } : {}),
    services,
    phone: row.phone,
    ...(row.alternatephone ? { alternatePhone: row.alternatephone } : {}),
    ...(row.whatsapp ? { whatsapp: row.whatsapp } : {}),
    email: row.email.trim(),
    ...(row.website ? { website: row.website } : {}),
    address: {
      addressLine1: row.addressline1.trim(),
      ...(row.addressline2 ? { addressLine2: row.addressline2 } : {}),
      ...(row.landmark ? { landmark: row.landmark } : {}),
      ...(row.locality ? { locality: row.locality } : {}),
      city: row.city.trim(),
      state: row.state.trim(),
      ...(row.postalcode ? { postalCode: row.postalcode } : {}),
      country: row.country || 'IN',
    },
    ...(workingHours.length ? { workingHours } : {}),
    ...(row.logo ? { logo: row.logo } : {}),
    images: csvList(row.images),
    ...(row.googleplaceid ? { googlePlaceId: row.googleplaceid.trim().replace(/\s+/g, '') } : {}),
    ...(row.pricerange ? { priceRange: row.pricerange } : {}),
    ...(row.amenities ? { amenities: csvList(row.amenities) } : {}),
    ...(row.establishedyear ? { establishedYear: csvNumber(row.establishedyear, 'establishedYear') } : {}),
    ...(row.teamsize ? { teamSize: csvNumber(row.teamsize, 'teamSize') } : {}),
    ...(row.responsetimeminutes ? { responseTimeMinutes: csvNumber(row.responsetimeminutes, 'responseTimeMinutes') } : {}),
    ...(row.mapembedurl ? { mapEmbedUrl: row.mapembedurl } : {}),
    ...(Object.keys(socialLinks).length ? { socialLinks } : {}),
    ...(row.faqs ? { faqs: csvJson(row.faqs, 'faqs') } : {}),
    ...(row.offers ? { offers: csvJson(row.offers, 'offers') } : {}),
    ...(row.highlights ? { highlights: csvList(row.highlights) } : {}),
    ...(row.timezone ? { timeZone: row.timezone } : {}),
  };
  if (business.images.length > 30) throw new Error('images can contain at most 30 URLs');
  if (business.highlights?.length > 30) throw new Error('highlights can contain at most 30 values');
  if (business.amenities?.length > 50) throw new Error('amenities can contain at most 50 values');
  if (business.faqs?.length > 50) throw new Error('faqs can contain at most 50 entries');
  if (business.offers?.length > 30) throw new Error('offers can contain at most 30 entries');
  return { business, owner };
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
export const importBusinesses = () => async (req, res, next) => { try {
  if (!req.file?.buffer) throw new AppError('Upload a CSV file', 422);
  const { headers, rows } = parseCsvTable(req.file.buffer.toString('utf8'));
  if (!rows.length) throw new AppError('CSV does not contain any business rows', 422);
  if (rows.length > 500) throw new AppError('A CSV can contain at most 500 business rows', 422);
  const normalizedHeaders = headers.map(header => header.toLowerCase());
  const requiredHeaders = ['name', 'owneremail', 'category', 'description', 'services', 'phone', 'email', 'addressline1', 'city', 'state'];
  const missingHeaders = requiredHeaders.filter(header => !normalizedHeaders.includes(header));
  if (missingHeaders.length) throw new AppError(`CSV is missing required columns: ${missingHeaders.join(', ')}`, 422);
  const allowedHeaders = new Set([...requiredHeaders, 'subcategory', 'alternatephone', 'whatsapp', 'website', 'addressline2', 'landmark', 'locality', 'postalcode', 'country', 'establishedyear', 'teamsize', 'pricerange', 'timezone', 'amenities', 'logo', 'images', 'facebook', 'instagram', 'linkedin', 'youtube', 'x', 'mapembedurl', 'googleplaceid', 'mondayhours', 'tuesdayhours', 'wednesdayhours', 'thursdayhours', 'fridayhours', 'saturdayhours', 'sundayhours', 'highlights', 'faqs', 'offers', 'responsetimeminutes']);
  const unknownHeaders = normalizedHeaders.filter(header => !allowedHeaders.has(header));
  if (unknownHeaders.length) throw new AppError(`CSV contains unsupported columns: ${unknownHeaders.join(', ')}`, 422);

  const created = []; const failed = [];
  for (const [index, values] of rows.entries()) {
    const rowNumber = index + 2;
    try {
      const { business, owner } = await businessFromCsvRow(values, normalizedHeaders);
      const item = await Business.create({ ...business, slug: await businessSlug(business.name), owner: owner._id, listingStatus: 'pending_review', verificationStatus: 'pending' });
      await item.populate([{ path: 'category', select: 'name slug' }, { path: 'owner', select: 'name email' }]);
      created.push(item);
    } catch (error) {
      if (error.name === 'ValidationError') {
        failed.push({ row: rowNumber, businessName: values[normalizedHeaders.indexOf('name')] || '', message: `Business validation failed for: ${Object.keys(error.errors).join(', ')}` });
      } else if (error.name === 'CastError') {
        failed.push({ row: rowNumber, businessName: values[normalizedHeaders.indexOf('name')] || '', message: `Invalid value for ${error.path}` });
      } else if (error.code === 11000) {
        const duplicateField = Object.keys(error.keyPattern || {})[0] || 'value';
        failed.push({ row: rowNumber, businessName: values[normalizedHeaders.indexOf('name')] || '', message: `A duplicate ${duplicateField} already exists` });
      } else if (error.name === 'Error') {
        failed.push({ row: rowNumber, businessName: values[normalizedHeaders.indexOf('name')] || '', message: error.message || 'Unable to import this business' });
      } else {
        next(error);
        return;
      }
    }
  }
  sendSuccess(res, 'Business CSV processed', { items: created, createdCount: created.length, failed, failedCount: failed.length });
} catch (error) { next(error); } };

export const reviewBusiness = () => async (req, res, next) => { try {
  const item = await Business.findOne({ _id: req.params.id, deletedAt: null, listingStatus: 'pending_review' });
  if (!item) throw new AppError('Business not found', 404);
  const { decision, rejectionReason } = req.validated.body;
  if (decision === 'approve' && (!item.description || !item.phone || !item.address?.addressLine1)) throw new AppError('This listing needs a description, phone, and address line 1 before approval', 422);
  if (decision === 'approve' && item.googlePlaceVerificationStatus === 'mismatch') throw new AppError('This listing has a mismatched Google Place ID. Reject the listing so the owner can correct it before approval.', 422);
  item.listingStatus = decision === 'approve' ? 'published' : 'rejected'; item.verificationStatus = decision === 'approve' ? 'verified' : 'rejected'; item.rejectionReason = decision === 'reject' ? rejectionReason : undefined;
  await item.save(); await item.populate('category', 'name slug'); sendSuccess(res, `Business ${decision}d successfully`, { item });
} catch (error) { next(error); } };

export const clearGooglePlaceMismatch = () => async (req, res, next) => { try {
  const item = await Business.findOne({ _id: req.params.id, deletedAt: null, googlePlaceVerificationStatus: 'mismatch' });
  if (!item) throw new AppError('Mismatched Google Place ID not found', 404);
  item.googlePlaceId = undefined;
  item.googlePlaceVerificationStatus = 'unverified';
  await item.save();
  await item.populate('category', 'name slug');
  sendSuccess(res, 'Mismatched Google Place ID cleared; the Google listing is now unlinked', { item });
} catch (error) { next(error); } };

export const categoryTree = () => async (_req, res, next) => { try { const items = await Category.find({ isActive: true }).sort('displayOrder name').lean(); const map = new Map(items.map(item => [String(item._id), { ...item, children: [] }])); const roots = []; for (const item of map.values()) item.parentCategory && map.has(String(item.parentCategory)) ? map.get(String(item.parentCategory)).children.push(item) : roots.push(item); sendSuccess(res, 'Category tree retrieved successfully', { items: roots }); } catch (error) { next(error); } };
export const createCategory = () => async (req, res, next) => { try { const { name, parentCategory } = req.validated.body; if (parentCategory && !await Category.exists({ _id: parentCategory, isActive: true, parentCategory: null })) throw new AppError('Parent category not found', 422); const { created } = await createCategories([{ name }], parentCategory || null); if (!created.length) throw new AppError('This category already exists at this level', 409); sendSuccess(res, 'Category created successfully', { item: created[0] }, 201); } catch (error) { next(error); } };
export const importCategories = parentFromPath => async (req, res, next) => { try { const parentCategory = parentFromPath ? req.params.id : null; if (parentCategory && !await Category.exists({ _id: parentCategory, isActive: true, parentCategory: null })) throw new AppError('Parent category not found', 422); if (!req.file?.buffer) throw new AppError('Upload a CSV file', 422); const result = await createCategories(csvRows(req.file.buffer.toString('utf8')), parentCategory); sendSuccess(res, 'Categories imported successfully', { created: result.created, createdCount: result.created.length, skipped: result.skipped }); } catch (error) { next(error); } };
export const addServices = () => async (req, res, next) => { try { const item = await Category.findOne({ _id: req.params.id, isActive: true }); if (!item) throw new AppError('Category or subcategory not found', 404); const services = [...new Set(req.validated.body.services.map(value => value.trim()).filter(Boolean))]; item.services = [...new Set([...item.services, ...services])]; await item.save(); sendSuccess(res, 'Services added successfully', { item, addedCount: services.length }); } catch (error) { next(error); } };
export const importServices = () => async (req, res, next) => { try { const item = await Category.findOne({ _id: req.params.id, isActive: true }); if (!item) throw new AppError('Category or subcategory not found', 404); if (!req.file?.buffer) throw new AppError('Upload a CSV file', 422); const services = csvRows(req.file.buffer.toString('utf8')).map(entry => entry.name); item.services = [...new Set([...item.services, ...services])]; await item.save(); sendSuccess(res, 'Services imported successfully', { item, addedCount: services.length }); } catch (error) { next(error); } };
