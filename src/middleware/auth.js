import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
export const authenticate = config => async (req, res, next) => {
  try {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) throw new AppError('Authentication required', 401);
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET);
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active' || (user.passwordChangedAt && payload.iat * 1000 < user.passwordChangedAt.getTime())) throw new AppError('Authentication required', 401);
    req.user = user; next();
  } catch (error) { next(error instanceof AppError ? error : new AppError('Authentication required', 401)); }
};
export const optionalAuthenticate = config => (req, res, next) => req.get('authorization') ? authenticate(config)(req, res, next) : next();
export const authorizeRoles = (...roles) => (req, res, next) => roles.includes(req.user?.role) ? next() : next(new AppError('You are not authorized for this action', 403));
