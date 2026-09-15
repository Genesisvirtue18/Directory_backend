import { Router } from 'express';
import { healthController } from '../controllers/healthController.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import * as auth from '../controllers/authController.js';
import * as users from '../controllers/userController.js';
import * as directory from '../controllers/directoryController.js';
import * as owner from '../controllers/ownerBusinessController.js';
import { authLogin, authRegister, idParam, objectId, pagination, refreshSchema } from '../validators/common.js';

const authLimiter = (req, res, next) => next(); // General API limiter is mounted by app; provider-specific limits can be configured per deployment.
const pageQuery = pagination.extend({ search: z.string().trim().max(100).optional(), parent: objectId.optional(), active: z.coerce.boolean().optional(), state: z.string().max(180).optional(), city: z.string().max(180).optional() });
const businessBody = z.object({ name:z.string().trim().min(2).max(180), slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180), category:objectId, description:z.string().max(10000).optional(), phone:z.string().max(30).optional(), email:z.string().email().optional(), website:z.url().optional(), address:z.object({addressLine1:z.string().max(250).optional(),city:z.string().max(120).optional(),locality:z.string().max(120).optional(),state:z.string().max(120).optional(),country:z.string().length(2).optional()}).partial().optional(), location:z.object({type:z.literal('Point').default('Point'),coordinates:z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)])}).optional(), workingHours:z.array(z.object({day:z.enum(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']),isClosed:z.boolean().optional(),opens:z.string().optional(),closes:z.string().optional()})).max(7).optional(), priceRange:z.enum(['budget','moderate','expensive','luxury']).optional(), keywords:z.array(z.string().max(80)).max(30).optional() }).strict();

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
  router.get('/owner/businesses', ...ownerOnly, validate(z.object({query:pagination})), owner.ownerBusinesses());
  router.post('/owner/businesses', ...ownerOnly, validate(z.object({body:businessBody})), owner.createBusiness());
  router.get('/owner/businesses/:id', ...ownerOnly, validate(idParam), owner.ownerBusiness());
  router.patch('/owner/businesses/:id', ...ownerOnly, validate(idParam.extend({body:businessBody.partial()})), owner.updateBusiness());
  router.delete('/owner/businesses/:id', ...ownerOnly, validate(idParam), owner.removeBusiness());
  router.post('/owner/businesses/:id/submit', ...ownerOnly, validate(idParam), owner.submitBusiness());
  const publicQuery=pageQuery.extend({q:z.string().max(100).optional(),category:z.string().max(180).optional(),verified:z.enum(['true','false']).optional(),minimumRating:z.coerce.number().min(0).max(5).optional()});
  router.get('/businesses', validate(z.object({query:publicQuery})), directory.businessList());
  router.get('/search', validate(z.object({query:publicQuery})), directory.businessList());
  router.get('/businesses/:slug', directory.businessBySlug());
  return router;
}
