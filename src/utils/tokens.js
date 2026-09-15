import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { RefreshToken } from '../models/RefreshToken.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const durationMs = value => { const match = /^(\d+)([mhd])$/.exec(value); return match ? Number(match[1]) * ({ m: 6e4, h: 36e5, d: 864e5 }[match[2]]) : 7 * 864e5; };
export const accessToken = (user, config) => jwt.sign({ sub: user.id, role: user.role, pv: user.passwordChangedAt?.getTime() || 0 }, config.JWT_ACCESS_SECRET, { expiresIn: config.JWT_ACCESS_EXPIRES_IN });
export async function issueTokens(user, config, req) {
  const raw = crypto.randomBytes(48).toString('base64url');
  await RefreshToken.create({ user: user.id, tokenHash: hash(raw), expiresAt: new Date(Date.now() + durationMs(config.JWT_REFRESH_EXPIRES_IN)), userAgent: req?.get('user-agent'), ip: req?.ip });
  return { accessToken: accessToken(user, config), refreshToken: raw };
}
export const findRefreshToken = raw => RefreshToken.findOne({ tokenHash: hash(raw), revokedAt: null }).select('+tokenHash');
export const revokeRefreshToken = raw => RefreshToken.updateOne({ tokenHash: hash(raw), revokedAt: null }, { $set: { revokedAt: new Date() } });
