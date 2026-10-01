import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/response.js';
import { findRefreshToken, issueTokens, revokeRefreshToken } from '../utils/tokens.js';
const publicUser = user => user.toJSON();
export const register = config => async (req, res, next) => { try {
  const { name, email, password } = req.validated.body;
  if (await User.exists({ email })) throw new AppError('An account with this email already exists', 409);
  const displayName = name || email.split('@')[0].replace(/[._-]+/g, ' ').trim().slice(0, 120) || 'Business Owner';
  const user = await User.create({ name: displayName.length >= 2 ? displayName : 'Business Owner', email, role: 'business_owner', passwordHash: await bcrypt.hash(password, 12) });
  const tokens = await issueTokens(user, config, req); sendSuccess(res, 'Registration successful', { user: publicUser(user), ...tokens }, 201);
} catch (e) { next(e); } };
export const login = config => async (req, res, next) => { try {
  const { email, password } = req.validated.body; const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || user.status !== 'active' || !await bcrypt.compare(password, user.passwordHash || '')) throw new AppError('Invalid email or password', 401);
  user.lastLoginAt = new Date(); await user.save(); const tokens = await issueTokens(user, config, req); sendSuccess(res, 'Login successful', { user: publicUser(user), ...tokens });
} catch (e) { next(e); } };
export const refresh = config => async (req, res, next) => { try {
  const session = await findRefreshToken(req.validated.body.refreshToken).populate('user');
  if (!session || session.expiresAt <= new Date() || session.user.status !== 'active') throw new AppError('Invalid refresh token', 401);
  session.revokedAt = new Date(); await session.save(); const tokens = await issueTokens(session.user, config, req); sendSuccess(res, 'Token refreshed', tokens);
} catch (e) { next(e); } };
export const logout = () => async (req, res, next) => { try { await revokeRefreshToken(req.validated.body.refreshToken); sendSuccess(res, 'Logged out successfully'); } catch (e) { next(e); } };
export const me = () => (req, res) => sendSuccess(res, 'Profile retrieved successfully', { user: publicUser(req.user) });
export const sessions = () => async (req, res, next) => { try { const items = await RefreshToken.find({ user: req.user.id, revokedAt: null }).select('-tokenHash'); sendSuccess(res, 'Sessions retrieved successfully', { items }); } catch (e) { next(e); } };
export const revokeSession = () => async (req, res, next) => { try { const result = await RefreshToken.updateOne({ _id: req.params.sessionId, user: req.user.id, revokedAt: null }, { $set: { revokedAt: new Date() } }); if (!result.matchedCount) throw new AppError('Session not found', 404); sendSuccess(res, 'Session revoked successfully'); } catch (e) { next(e); } };
export const revokeAll = () => async (req, res, next) => { try { await RefreshToken.updateMany({ user: req.user.id, revokedAt: null }, { $set: { revokedAt: new Date() } }); sendSuccess(res, 'All sessions revoked successfully'); } catch (e) { next(e); } };
