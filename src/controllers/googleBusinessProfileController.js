import { Business } from '../models/Business.js';
import { GoogleBusinessConnection, GoogleBusinessOAuthState, GoogleBusinessSelection } from '../models/GoogleBusinessConnection.js';
import { encryptRefreshToken, getGoogleAccessToken, googleFetch, hashState, listAllPages, safeGoogleError, stateToken } from '../services/googleBusinessProfile.js';
import { sendError, sendSuccess } from '../utils/response.js';

const expiry = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const noStore = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
const owned = async (id, user) => Business.findOne({ _id: id, owner: user._id, deletedAt: null });
const ownerFail = (res, item) => !item && sendError(res, 404, 'Business not found');
const configured = config => Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REDIRECT_URI && config.GOOGLE_TOKEN_ENCRYPTION_KEY);
const callbackUrl = (config, status) => `${config.CLIENT_URL}/business-owner?googleBusinessProfile=${status}`;

export const googleBusinessProfile = config => ({
  status: [noStore, async (req, res) => {
    const item = await owned(req.params.id, req.user); if (ownerFail(res, item)) return;
    if (!configured(config)) return sendSuccess(res, 'Google Business Profile is not configured', { configured: false, connected: false, selectedLocation: null });
    const [connection, selection] = await Promise.all([GoogleBusinessConnection.exists({ business: item._id, owner: req.user._id }), GoogleBusinessSelection.findOne({ business: item._id, owner: req.user._id, expiresAt: { $gt: new Date() } }).lean()]);
    return sendSuccess(res, 'Google connection status retrieved', { configured: true, connected: Boolean(connection), selectedLocation: selection ? { title: selection.title, expiresAt: selection.expiresAt } : null });
  }],
  connect: [noStore, async (req, res) => {
    if (!configured(config)) return sendError(res, 503, 'Google Business Profile integration is not configured');
    const item = await owned(req.params.id, req.user); if (ownerFail(res, item)) return;
    const state = stateToken(); await GoogleBusinessOAuthState.create({ hash: hashState(state), business: item._id, owner: req.user._id, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID, redirect_uri: config.GOOGLE_REDIRECT_URI, response_type: 'code', scope: 'https://www.googleapis.com/auth/business.manage', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state }).toString();
    return sendSuccess(res, 'Google authorization started', { authorizationUrl: url.toString() });
  }],
  callback: async (req, res) => {
    const { code, state, error } = req.query;
    if (error || typeof code !== 'string' || typeof state !== 'string') return res.redirect(callbackUrl(config, 'error'));
    const oauthState = await GoogleBusinessOAuthState.findOneAndDelete({ hash: hashState(state), expiresAt: { $gt: new Date() } });
    if (!oauthState) return res.redirect(callbackUrl(config, 'error'));
    const item = await Business.findOne({ _id: oauthState.business, owner: oauthState.owner, deletedAt: null });
    if (!item || !configured(config)) return res.redirect(callbackUrl(config, 'error'));
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, redirect_uri: config.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(12000) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.refresh_token) return res.redirect(callbackUrl(config, 'error'));
      await GoogleBusinessConnection.findOneAndUpdate({ business: item._id }, { owner: item.owner, refreshToken: encryptRefreshToken(data.refresh_token, config) }, { upsert: true, new: true, runValidators: true });
      await GoogleBusinessSelection.deleteOne({ business: item._id });
      return res.redirect(callbackUrl(config, 'connected'));
    } catch { return res.redirect(callbackUrl(config, 'error')); }
  },
  locations: [noStore, async (req, res) => {
    const item = await owned(req.params.id, req.user); if (ownerFail(res, item)) return;
    const connection = await GoogleBusinessConnection.findOne({ business: item._id, owner: req.user._id }); if (!connection) return sendError(res, 409, 'Connect a Google account first');
    try {
      const access = await getGoogleAccessToken(connection, config);
      const accounts = await listAllPages('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', access, 'accounts');
      const locations = (await Promise.all(accounts.filter(account => account.name).map(account => listAllPages(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title,storefrontAddress,metadata&pageSize=100`, access, 'locations').then(items => items.map(location => ({ ...location, accountName: account.name })))))).flat();
      return sendSuccess(res, 'Google locations retrieved', { locations: locations.map(location => ({ accountName: location.accountName, locationName: location.name, title: location.title, address: location.storefrontAddress?.addressLines?.join(', '), city: location.storefrontAddress?.locality, mapsUri: location.metadata?.mapsUri })) });
    } catch (error) { const [status, message] = safeGoogleError(error); return sendError(res, status, message); }
  }],
  selectLocation: [noStore, async (req, res) => {
    const item = await owned(req.params.id, req.user); if (ownerFail(res, item)) return;
    const { accountName, locationName } = req.validated.body;
    if (!/^accounts\/[^/]+$/.test(accountName) || !/^locations\/[^/]+$/.test(locationName)) return sendError(res, 400, 'Invalid Google location selection');
    const connection = await GoogleBusinessConnection.findOne({ business: item._id, owner: req.user._id }); if (!connection) return sendError(res, 409, 'Connect a Google account first');
    try {
      const access = await getGoogleAccessToken(connection, config);
      const result = await googleFetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/${locationName}?readMask=name,title,metadata`, access);
      if (result.name !== locationName) return sendError(res, 400, 'Google returned a different location than the one selected');
      await GoogleBusinessSelection.findOneAndUpdate({ business: item._id }, { owner: req.user._id, accountName, locationName, title: result.title || item.name, mapsUri: result.metadata?.mapsUri, expiresAt: expiry() }, { upsert: true, runValidators: true });
      return sendSuccess(res, 'Google location selected', { selectedLocation: { title: result.title || item.name } });
    } catch (error) { const [status, message] = safeGoogleError(error); return sendError(res, status, message); }
  }],
  disconnect: [noStore, async (req, res) => {
    const item = await owned(req.params.id, req.user); if (ownerFail(res, item)) return;
    await Promise.all([GoogleBusinessConnection.deleteOne({ business: item._id, owner: req.user._id }), GoogleBusinessSelection.deleteOne({ business: item._id, owner: req.user._id })]);
    return sendSuccess(res, 'Google Business Profile disconnected', { connected: false });
  }],
  reviews: [noStore, async (req, res) => {
    const item = await Business.findOne({ slug: req.params.slug, listingStatus: 'published', deletedAt: null }).select('_id').lean();
    if (!item) return sendError(res, 404, 'Business not found');
    const selection = await GoogleBusinessSelection.findOne({ business: item._id, expiresAt: { $gt: new Date() } }).lean();
    if (!selection) return sendSuccess(res, 'Google reviews are not connected', { available: false, reviews: [], mapsUri: null });
    const connection = await GoogleBusinessConnection.findOne({ business: item._id, owner: selection.owner });
    if (!connection) return sendSuccess(res, 'Google reviews are not connected', { available: false, reviews: [], mapsUri: null });
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
    try {
      const access = await getGoogleAccessToken(connection, config);
      const target = new URL(`https://mybusiness.googleapis.com/v4/${selection.accountName}/${selection.locationName}/reviews`);
      target.searchParams.set('pageSize', String(pageSize)); if (typeof req.query.pageToken === 'string' && req.query.pageToken.length < 2048) target.searchParams.set('pageToken', req.query.pageToken);
      const data = await googleFetch(target, access);
      return sendSuccess(res, 'Google reviews retrieved', { available: true, locationTitle: selection.title, mapsUri: selection.mapsUri, averageRating: data.averageRating || 0, totalReviewCount: data.totalReviewCount || 0, reviews: (data.reviews || []).map(review => ({ name: review.reviewer?.displayName || 'Google user', photoUrl: review.reviewer?.profilePhotoUrl, rating: ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 })[review.starRating] || 0, comment: review.comment || '', createTime: review.createTime, updateTime: review.updateTime })), nextPageToken: data.nextPageToken || null });
    } catch (error) { const [status, message] = safeGoogleError(error); if (status === 404) return sendSuccess(res, 'Google reviews are unavailable', { available: false, reviews: [], mapsUri: selection.mapsUri }); return sendError(res, status, message); }
  }],
});
