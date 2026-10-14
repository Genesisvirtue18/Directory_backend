import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { cloudinary, configureCloudinary } from '../config/cloudinary.js';
import { healthController } from '../controllers/healthController.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import * as auth from '../controllers/authController.js';
import * as users from '../controllers/userController.js';
import * as directory from '../controllers/directoryController.js';
import * as owner from '../controllers/ownerBusinessController.js';
import * as admin from '../controllers/adminController.js';
import { authLogin, authRegister, idParam, objectId, pagination, refreshSchema } from '../validators/common.js';

const authLimiter = (req, res, next) => next(); // General API limiter is mounted by app; provider-specific limits can be configured per deployment.
const pageQuery = pagination.extend({ search: z.string().trim().max(100).optional(), parent: objectId.optional(), active: z.coerce.boolean().optional(), state: z.string().max(180).optional(), city: z.string().max(180).optional() });
const httpUrl = z.url().refine(value => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}, 'Use an HTTP(S) URL');
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, done) => done(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, done) => done(null, /\.(csv|txt)$/i.test(file.originalname)) });
const businessBody = z.object({ name:z.string().trim().min(2).max(180), slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180).optional(), category:objectId, description:z.string().max(10000).optional(), phone:z.string().max(30).optional(), alternatePhone:z.string().max(30).optional(), whatsapp:z.string().max(30).optional(), email:z.string().email().optional(), website:httpUrl.optional(), address:z.object({addressLine1:z.string().max(250).optional(),addressLine2:z.string().max(250).optional(),landmark:z.string().max(150).optional(),city:z.string().max(120).optional(),locality:z.string().max(120).optional(),state:z.string().max(120).optional(),postalCode:z.string().max(20).optional(),country:z.string().length(2).optional()}).partial().optional(), workingHours:z.array(z.object({day:z.enum(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']),isClosed:z.boolean().optional(),opens:z.string().optional(),closes:z.string().optional()})).max(7).optional(), logo:httpUrl.optional(),images:z.array(httpUrl).max(30).optional(),photoCount:z.coerce.number().int().min(0).optional(),priceRange:z.enum(['budget','moderate','expensive','luxury']).optional(),keywords:z.array(z.string().max(80)).max(30).optional(),highlights:z.array(z.string().max(180)).max(30).optional(),amenities:z.array(z.string().max(180)).max(50).optional(),establishedYear:z.coerce.number().int().min(1800).max(new Date().getFullYear()).optional(),teamSize:z.coerce.number().int().min(1).optional(),responseTimeMinutes:z.coerce.number().int().min(0).optional(),googlePlaceId:z.string().max(300).optional(),mapEmbedUrl:httpUrl.optional(),socialLinks:z.object({facebook:httpUrl.optional(),instagram:httpUrl.optional(),linkedin:httpUrl.optional(),youtube:httpUrl.optional(),x:httpUrl.optional()}).optional(),faqs:z.array(z.object({question:z.string().min(1).max(500),answer:z.string().min(1).max(3000)})).max(50).optional(),offers:z.array(z.object({title:z.string().min(1).max(180),description:z.string().max(2000).optional(),code:z.string().max(50).optional(),validFrom:z.coerce.date().optional(),validUntil:z.coerce.date().optional(),isActive:z.boolean().optional()})).max(30).optional(),subcategories:z.array(objectId).max(30).optional(),services:z.array(z.string().max(150)).max(100).optional(),reviews:z.array(z.object({reviewerName:z.string().min(1).max(120),reviewerAvatar:httpUrl.optional(),rating:z.coerce.number().min(1).max(5),comment:z.string().max(3000).optional(),isVerified:z.boolean().optional(),createdAt:z.coerce.date().optional()})).max(100).optional(),timeZone:z.string().max(120).optional() }).strict();
const emptyableUrl = httpUrl.or(z.literal(''));
const googleMapsUrl = emptyableUrl.refine(value => {
  if (!value) return true;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'google.com' || host.endsWith('.google.com') || host === 'google.co.in' || host.endsWith('.google.co.in');
  } catch { return false; }
}, 'Use a Google Maps link');
const ownerBusinessBody = businessBody.omit({ reviews: true, slug: true, photoCount: true, website: true, email: true, logo: true, mapEmbedUrl: true, socialLinks: true }).extend({
  website: emptyableUrl.optional(), email: z.union([z.string().email(), z.literal('')]).optional(), logo: emptyableUrl.optional(), mapEmbedUrl: googleMapsUrl.optional(),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian phone number'),
  alternatePhone: z.union([z.string().regex(/^[6-9]\d{9}$/), z.literal('')]).optional(),
  whatsapp: z.union([z.string().regex(/^[6-9]\d{9}$/), z.literal('')]).optional(),
  services: z.array(z.string().trim().min(1).max(150)).min(1, 'Select at least one service'),
  address: z.object({ addressLine1: z.string().trim().min(1).max(250), addressLine2: z.string().max(250).optional(), landmark: z.string().max(150).optional(), city: z.string().trim().min(1).max(120), locality: z.string().max(120).optional(), state: z.string().trim().min(1).max(120), postalCode: z.string().max(20).optional(), country: z.string().length(2).optional() }),
  socialLinks: z.object({ facebook: emptyableUrl.optional(), instagram: emptyableUrl.optional(), linkedin: emptyableUrl.optional(), youtube: emptyableUrl.optional(), x: emptyableUrl.optional() }).optional(),
  location: z.object({ type: z.literal('Point').default('Point'), coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) }).nullable().optional(),
});

export function apiRouter(config, databaseState) {
  const router = Router();
  router.get('/health', healthController(config, databaseState));
  router.post('/auth/register', authLimiter, validate(authRegister), auth.register(config));
  router.post('/auth/login', authLimiter, validate(authLogin), auth.login(config));
  router.post('/auth/refresh-token', authLimiter, validate(refreshSchema), auth.refresh(config));
  router.post('/auth/logout', validate(refreshSchema), auth.logout());
  router.get('/auth/me', authenticate(config), auth.me());
  router.get('/auth/sessions', authenticate(config), auth.sessions());
  router.delete('/auth/sessions', authenticate(config), auth.revokeAll());
  router.delete('/auth/sessions/:sessionId', authenticate(config), auth.revokeSession());
  router.get('/users/me', authenticate(config), users.profile());
  router.patch('/users/me', authenticate(config), validate(z.object({body:z.object({name:z.string().trim().min(2).max(120).optional(),phone:z.string().max(30).optional(),avatar:z.url().optional(),notificationPreferences:z.object({email:z.boolean().optional(),sms:z.boolean().optional()}).optional()}).strict()})), users.updateProfile());
  router.delete('/users/me', authenticate(config), users.deleteAccount());
  router.get('/users/me/activity', authenticate(config), users.activity());
  router.get('/categories', validate(z.object({query:pageQuery})), directory.categories());
  router.get('/categories/popular', validate(z.object({query:pagination})), (req,res,next)=>{req.validated.query={...req.validated.query}; directory.categories()(req,res,next);});
  router.get('/categories/tree', directory.categoryTree());
  router.get('/categories/:slug', directory.categoryBySlug());
  router.get('/locations/states', validate(z.object({query:pageQuery})), directory.locations('state'));
  router.get('/locations/cities', validate(z.object({query:pageQuery})), directory.locations('city'));
  router.get('/locations/localities', validate(z.object({query:pageQuery})), directory.locations('locality'));
  router.get('/locations/popular-cities', validate(z.object({query:pagination})), directory.locations('city'));
  const ownerOnly = [authenticate(config), authorizeRoles('business_owner', 'admin', 'super_admin')];
  router.post('/owner/uploads', ...ownerOnly, imageUpload.array('images', 10), (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ success: false, message: 'Select at least one image', errors: [] });
    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = config;
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      return res.status(503).json({ success: false, message: 'Image uploads are not configured. The site administrator must add the Cloudinary cloud name, API key, and API secret to the server environment.', errors: [] });
    }
    configureCloudinary(config);
    Promise.all(files.map(async file => {
      const detected = await fileTypeFromBuffer(file.buffer);
      if (!detected || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(detected.mime)) {
        const error = new Error('Only valid JPEG, PNG, WebP, or GIF images are allowed');
        error.status = 400;
        throw error;
      }
      return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream({ folder: 'business-directory', resource_type: 'image' }, (error, result) => {
          if (error) return reject(error);
          if (!result?.secure_url) return reject(new Error('Cloudinary did not return an image URL'));
          resolve(result.secure_url);
        }).end(file.buffer);
      });
    })).then(urls => sendSuccess(res, 'Images uploaded successfully', { urls }, 201)).catch(error => {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message, errors: [] });
      console.error('Image upload provider failed', {
        type: error.name || 'Error',
        status: error.http_code || error.status || undefined,
        code: error.code || error.error?.code || undefined,
      });
      res.status(502).json({ success: false, message: 'Unable to upload images', errors: [] });
    });
  });
  router.get('/owner/businesses', ...ownerOnly, validate(z.object({query:pagination})), owner.ownerBusinesses());
  router.post('/owner/businesses', ...ownerOnly, validate(z.object({body:ownerBusinessBody.extend({ email: z.string().email('Enter a valid email address') })})), owner.createBusiness());
  router.get('/owner/businesses/:id', ...ownerOnly, validate(idParam), owner.ownerBusiness());
  router.patch('/owner/businesses/:id', ...ownerOnly, validate(idParam.extend({body:ownerBusinessBody.partial()})), owner.updateBusiness());
  router.delete('/owner/businesses/:id', ...ownerOnly, validate(idParam), owner.removeBusiness());
  router.post('/owner/businesses/:id/submit', ...ownerOnly, validate(idParam), owner.submitBusiness());
  const adminOnly = [authenticate(config), authorizeRoles('admin', 'super_admin')];
  const categoryBody = z.object({ name: z.string().trim().min(2).max(120), parentCategory: objectId.optional() }).strict();
  const servicesBody = z.object({ services: z.array(z.string().trim().min(1).max(150)).min(1).max(500) }).strict();
  router.get('/admin/categories', ...adminOnly, admin.categoryTree());
  router.post('/admin/categories', ...adminOnly, validate(z.object({ body: categoryBody })), admin.createCategory());
  router.post('/admin/categories/import', ...adminOnly, csvUpload.single('file'), admin.importCategories(false));
  router.post('/admin/categories/:id/subcategories/import', ...adminOnly, validate(idParam), csvUpload.single('file'), admin.importCategories(true));
  router.post('/admin/categories/:id/services', ...adminOnly, validate(idParam.extend({ body: servicesBody })), admin.addServices());
  router.post('/admin/categories/:id/services/import', ...adminOnly, validate(idParam), csvUpload.single('file'), admin.importServices());
  router.get('/admin/owners', ...adminOnly, admin.owners());
  router.get('/admin/businesses', ...adminOnly, validate(z.object({ query: pagination.extend({ status: z.enum(['draft', 'pending_review', 'published', 'suspended', 'rejected']).optional() }) })), admin.businesses());
  router.patch('/admin/businesses/:id/review', ...adminOnly, validate(idParam.extend({ body: z.object({ decision: z.enum(['approve', 'reject']), rejectionReason: z.string().trim().max(2000).optional() }).strict() })), admin.reviewBusiness());
const publicQuery=pageQuery.extend({q:z.string().trim().max(100).optional(),category:z.string().trim().max(180).optional(),city:z.string().trim().max(120).optional(),locality:z.string().trim().max(120).optional(),state:z.string().trim().max(120).optional(),verified:z.enum(['true','false']).optional(),minimumRating:z.coerce.number().min(0).max(5).optional(),lat:z.coerce.number().min(-90).max(90).optional(),lng:z.coerce.number().min(-180).max(180).optional(),radiusMeters:z.coerce.number().int().min(100).max(50000).default(10000),openNow:z.enum(['true','false']).optional(),sort:z.enum(['relevance','rating','newest','distance']).default('relevance')}).refine(q=>(q.lat===undefined)===(q.lng===undefined),{message:'Latitude and longitude must be provided together',path:['lat']}).refine(q=>q.openNow===undefined||q.lat!==undefined,{message:'Open/closed filtering requires coordinates',path:['openNow']});
  router.get('/businesses', validate(z.object({query:publicQuery})), directory.businessList());
  router.get('/search', validate(z.object({query:publicQuery})), directory.businessList());
  router.get('/businesses/:slug', directory.businessBySlug());
  return router;
}
