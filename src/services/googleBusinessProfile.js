import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const hashState = value => createHash('sha256').update(value).digest('hex');
const encryptionKey = config => Buffer.from(config.GOOGLE_TOKEN_ENCRYPTION_KEY, 'hex');
export function encryptRefreshToken(value, config) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(config), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(item => item.toString('base64url')).join('.');
}
export function decryptRefreshToken(value, config) {
  const [iv, tag, encrypted] = value.split('.').map(item => Buffer.from(item, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(config), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
export const stateToken = () => randomBytes(32).toString('base64url');

export async function googleFetch(url, accessToken, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(response.status === 401 ? 'GOOGLE_REAUTH' : response.status === 403 ? 'GOOGLE_PERMISSION' : response.status === 404 ? 'GOOGLE_NOT_FOUND' : 'GOOGLE_UNAVAILABLE');
    error.status = response.status;
    error.upstreamStatus = response.status;
    error.googleReason = body.error?.status || body.error?.errors?.[0]?.reason || body.error?.details?.[0]?.reason;
    throw error;
  }
  return response.json();
}

export async function getGoogleAccessToken(connection, config) {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, refresh_token: decryptRefreshToken(connection.refreshToken, config), grant_type: 'refresh_token' }), signal: AbortSignal.timeout(12000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) { const error = new Error(response.status === 400 ? 'GOOGLE_REAUTH' : 'GOOGLE_UNAVAILABLE'); error.status = response.status; error.upstreamStatus = response.status; error.googleReason = body.error; throw error; }
  return body.access_token;
}

export async function listAllPages(url, token, key) {
  const all = []; let pageToken;
  for (let page = 0; page < 20; page++) {
    const target = new URL(url); if (pageToken) target.searchParams.set('pageToken', pageToken);
    const body = await googleFetch(target, token); all.push(...(body[key] || [])); pageToken = body.nextPageToken;
    if (!pageToken) return all;
  }
  throw new Error('GOOGLE_TOO_MANY_PAGES');
}

export function safeGoogleError(error) {
  if (error.message === 'GOOGLE_REAUTH') return [401, 'Google access expired. Reconnect your Business Profile.'];
  if (error.message === 'GOOGLE_PERMISSION') return [403, 'Google denied access. Confirm this account manages a verified Business Profile and try again.'];
  if (error.message === 'GOOGLE_NOT_FOUND') return [404, 'The selected Google location is unavailable. Choose it again.'];
  return [503, 'Google Business Profile is temporarily unavailable. Please try again shortly.'];
}

export function logGoogleFailure(operation, error) {
  const reason = typeof error?.googleReason === 'string' && error.googleReason.length <= 80 && /^[A-Za-z0-9_.-]+$/.test(error.googleReason) ? error.googleReason : undefined;
  const code = typeof error?.code === 'string' && error.code.length <= 80 && /^[A-Za-z0-9_.-]+$/.test(error.code) ? error.code
    : typeof error?.message === 'string' && /^GOOGLE_[A-Z_]+$/.test(error.message) ? error.message : undefined;
  console.error('[Google Business Profile] Request failed', {
    operation,
    status: Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : Number.isInteger(error?.status) ? error.status : undefined,
    reason,
    code,
    errorType: typeof error?.name === 'string' ? error.name : undefined,
  });
}
