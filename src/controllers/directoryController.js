import { Category } from '../models/Category.js';
import { Location } from '../models/Location.js';
import { Business } from '../models/Business.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/response.js';
const pageResult = async (Model, filter, req, message, select, sort = { name: 1, _id: 1 }, populate, collation) => { const { page, limit } = req.validated.query; let find = Model.find(filter).select(select || '').sort(sort).skip((page - 1) * limit).limit(limit); let count = Model.countDocuments(filter); if (populate) find = find.populate(populate); if (collation) { find = find.collation(collation); count = count.collation(collation); } const [items, totalItems] = await Promise.all([find.lean(), count]); return { items, pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit), hasNextPage: page * limit < totalItems, hasPreviousPage: page > 1 } }; };
const standardizeReviewStats = item => {
  if (!item?.reviews?.length) return { ...item, averageRating: Number(item.averageRating || 0), reviewCount: Number(item.reviewCount || 0) };
  const ratings = item.reviews.map(review => Number(review.rating)).filter(rating => Number.isFinite(rating) && rating >= 1 && rating <= 5);
  return { ...item, reviews: item.reviews.map(review => ({ ...review, rating: Number(review.rating) })), averageRating: ratings.length ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2)) : 0, reviewCount: ratings.length };
};
const caseInsensitiveExact = value => new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
export const categories = () => async (req, res, next) => { try { const q = req.validated.query; const filter = { isActive: q.active ?? true }; if (q.parent) filter.parentCategory = q.parent; if (q.search) filter.$text = { $search: q.search }; sendSuccess(res, 'Categories retrieved successfully', await pageResult(Category, filter, req)); } catch (e) { next(e); } };
export const categoryBySlug = () => async (req, res, next) => { try { const item = await Category.findOne({ slug: req.params.slug, isActive: true }); if (!item) throw new AppError('Category not found', 404); sendSuccess(res, 'Category retrieved successfully', { item }); } catch (e) { next(e); } };
export const categoryTree = () => async (req,res,next) => { try { const items = await Category.find({ isActive: true }).sort('displayOrder name').lean(); const roots = []; const map = new Map(items.map(x => [String(x._id), { ...x, children: [] }])); for (const item of map.values()) item.parentCategory && map.has(String(item.parentCategory)) ? map.get(String(item.parentCategory)).children.push(item) : roots.push(item); sendSuccess(res,'Category tree retrieved successfully',{items:roots}); } catch(e){next(e);} };
export const locations = type => () => async (req,res,next) => { try { const q=req.validated.query; const filter={ type, isActive:true }; if(q.search) filter.name=new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'); if(q.state) { const state=await Location.findOne({slug:q.state,type:'state'}); filter.state=state?._id || null; } if(q.city) { const city=await Location.findOne({slug:q.city,type:'city'}); filter.city=city?._id || null; } sendSuccess(res,`${type}s retrieved successfully`,await pageResult(Location,filter,req)); } catch(e){next(e);} };
export const businessCities = () => async (req, res, next) => {
  try {
    const cityNames = await Business.distinct('address.city', {
      listingStatus: 'published',
      deletedAt: null,
      'address.city': { $type: 'string', $ne: '' },
    });
    const citiesByName = new Map();
    for (const city of cityNames) {
      const name = typeof city === 'string' ? city.trim() : '';
      if (name && !citiesByName.has(name.toLocaleLowerCase())) citiesByName.set(name.toLocaleLowerCase(), name);
    }
    const items = [...citiesByName.values()]
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
      .map(name => ({ name }));
    sendSuccess(res, 'Cities with published businesses retrieved successfully', { items });
  } catch (error) {
    next(error);
  }
};
const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const localClock = (date, timeZone) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || 'Asia/Kolkata', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return { day: values.weekday.toLowerCase(), time: `${values.hour}:${values.minute}` };
  } catch { return localClock(date, 'Asia/Kolkata'); }
};
const businessIsOpenNow = (business, now = new Date()) => {
  const { day, time } = localClock(now, business.timeZone);
  const todayIndex = weekdayNames.indexOf(day);
  const yesterday = weekdayNames[(todayIndex + 6) % 7];
  return (business.workingHours || []).some(hours => {
    if (hours.isClosed || !hours.opens || !hours.closes) return false;
    if (hours.day === day && (hours.opens <= hours.closes ? hours.opens <= time && time < hours.closes : hours.opens <= time)) return true;
    return hours.day === yesterday && hours.opens > hours.closes && time < hours.closes;
  });
};
export const businessList = () => async (req,res,next) => { try {
  const q=req.validated.query;
  const filter={listingStatus:'published',deletedAt:null};
  if(q.q) {
    if (q.lat !== undefined) {
      const term = new RegExp(caseInsensitiveExact(q.q).source.slice(1, -1), 'i');
      filter.$or = [{ name: term }, { description: term }, { keywords: term }, { services: term }];
    } else filter.$text={$search:q.q};
  }
  if(q.category) {
    const cat = await Category.findOne({ slug: q.category, isActive: true }).select('_id').lean();
    if (!cat) filter.category = null; else filter.category = cat._id;
  }
  if(q.city) filter['address.city']=q.q ? caseInsensitiveExact(q.city) : q.city;
  if(q.locality) filter['address.locality']=q.q ? caseInsensitiveExact(q.locality) : q.locality;
  if(q.state) filter['address.state']=q.q ? caseInsensitiveExact(q.state) : q.state;
  if(q.verified === 'true') filter.verificationStatus='verified';
  if(q.verified === 'false') filter.verificationStatus={$ne:'verified'};
  if(q.minimumRating !== undefined) filter.averageRating={$gte:q.minimumRating};
  if (q.lat !== undefined) {
    const pipeline = [
      { $geoNear: { near: { type: 'Point', coordinates: [q.lng, q.lat] }, key: 'location', distanceField: 'distanceMeters', maxDistance: q.radiusMeters, spherical: true, query: filter } },
      { $project: { owner: 0, rejectionReason: 0, googlePlaceId: 0, googlePlaceVerificationStatus: 0, reviews: 0 } },
    ];
    if (q.openNow !== undefined) {
      let nearby = (await Business.aggregate(pipeline)).map(item => ({ ...item, isOpenNow: businessIsOpenNow(item) })).filter(item => item.isOpenNow === (q.openNow === 'true'));
      if (q.sort === 'rating') nearby.sort((a, b) => b.averageRating - a.averageRating || b.reviewCount - a.reviewCount || a.distanceMeters - b.distanceMeters);
      if (q.sort === 'newest') nearby.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || a.distanceMeters - b.distanceMeters);
      const totalItems = nearby.length;
      const items = nearby.slice((q.page - 1) * q.limit, q.page * q.limit).map(standardizeReviewStats);
      await Business.populate(items, { path: 'category', select: 'name slug' });
      return sendSuccess(res, 'Nearby businesses retrieved successfully', { items, pagination: { page: q.page, limit: q.limit, totalItems, totalPages: Math.ceil(totalItems / q.limit), hasNextPage: q.page * q.limit < totalItems, hasPreviousPage: q.page > 1 } });
    }
    if (q.sort === 'rating') pipeline.push({ $sort: { averageRating: -1, reviewCount: -1, distanceMeters: 1, _id: 1 } });
    if (q.sort === 'newest') pipeline.push({ $sort: { createdAt: -1, distanceMeters: 1, _id: 1 } });
    pipeline.push({ $facet: { items: [{ $skip: (q.page - 1) * q.limit }, { $limit: q.limit }], count: [{ $count: 'totalItems' }] } });
    const [result = { items: [], count: [] }] = await Business.aggregate(pipeline);
    const items = result.items.map(item => ({ ...standardizeReviewStats(item), isOpenNow: businessIsOpenNow(item) }));
    const totalItems = result.count[0]?.totalItems || 0;
    await Business.populate(items, { path: 'category', select: 'name slug' });
    return sendSuccess(res, 'Nearby businesses retrieved successfully', { items, pagination: { page: q.page, limit: q.limit, totalItems, totalPages: Math.ceil(totalItems / q.limit), hasNextPage: q.page * q.limit < totalItems, hasPreviousPage: q.page > 1 } });
  }
  const sort = q.sort === 'rating' ? { averageRating: -1, reviewCount: -1, _id: 1 } : q.sort === 'newest' ? { createdAt: -1, _id: 1 } : q.q ? { score: { $meta: 'textScore' }, _id: 1 } : { isFeatured: -1, averageRating: -1, _id: 1 };
  const insensitive = q.q ? undefined : { locale: 'en', strength: 2 };
  const data=await pageResult(Business,filter,req,'Businesses retrieved successfully','-owner -rejectionReason -googlePlaceId -googlePlaceVerificationStatus',sort,{ path: 'category', select: 'name slug' },insensitive);
  data.items = data.items.map(standardizeReviewStats);
  sendSuccess(res,'Businesses retrieved successfully',data);
}catch(e){next(e);} };
export const businessBySlug = () => async (req,res,next) => { try { const item=await Business.findOne({slug:req.params.slug,listingStatus:'published',deletedAt:null}).select('-owner -rejectionReason -googlePlaceId -googlePlaceVerificationStatus').populate('category','name slug').populate('subcategories','name slug').lean(); if(!item) throw new AppError('Business not found',404); sendSuccess(res,'Business retrieved successfully',{item:standardizeReviewStats(item)}); }catch(e){next(e);} };
