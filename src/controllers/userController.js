import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/response.js';
export const profile = () => (req, res) => sendSuccess(res, 'Profile retrieved successfully', { user: req.user.toJSON() });
export const updateProfile = () => async (req, res, next) => { try { const allowed = ['name', 'phone', 'avatar', 'notificationPreferences']; for (const key of allowed) if (key in req.validated.body) req.user[key] = req.validated.body[key]; await req.user.save(); sendSuccess(res, 'Profile updated successfully', { user: req.user.toJSON() }); } catch (e) { next(e); } };
export const deleteAccount = () => async (req, res, next) => { try { req.user.status = 'deleted'; req.user.deletedAt = new Date(); await req.user.save(); sendSuccess(res, 'Account deleted successfully'); } catch (e) { next(e); } };
export const activity = () => async (req, res, next) => { try { const items = await User.findById(req.user.id).select('createdAt lastLoginAt passwordChangedAt'); sendSuccess(res, 'Activity retrieved successfully', { items }); } catch (e) { next(e); } };
